<script lang="ts">
	import { goto } from '$app/navigation';
	import TripEditor from '$lib/editor/TripEditor.svelte';
	import CreationWizard from '$lib/editor/CreationWizard.svelte';
	import BottomBar from '$lib/nav/BottomBar.svelte';
	import type { Trip } from '$lib/trip-engine';
	import { pruneEmpty, slugifyId } from '$lib/editor/factories';
	import { validateTripDoc, type TripDoc } from '$lib/validateTrip';
	import { t } from '$lib/i18n/store.svelte';

	let { data } = $props();

	// The landing is a two-step creation wizard. "Start from a blank trip" still
	// drops into the blank form editor — a trip with no title can't be created
	// yet, so there's nothing to edit in place.
	//
	// The wizard path no longer stops at a form for review (Phase 5): it creates
	// the trip and lands the author in edit mode ON the real itinerary, so the
	// first thing they touch is the finished trip rather than a form describing
	// one. Anything the wizard couldn't ask for is then filled in where it shows.
	let stage = $state<'wizard' | 'blank' | 'creating'>('wizard');
	let createError = $state<string[]>([]);

	async function onCreate(trip: Trip) {
		stage = 'creating';
		createError = [];
		const clean = pruneEmpty($state.snapshot(trip)) as TripDoc | undefined;
		if (!clean) {
			createError = [t('editor.errTripEmpty')];
			stage = 'wizard';
			return;
		}
		// The client must supply a schema-valid id or the doc is rejected before
		// it reaches the server; the server still dedupes against existing trips.
		const titleText = (clean.title?.[clean.defaultLanguage] ?? '').trim();
		if (!titleText) {
			createError = [t('editor.errGiveTitle')];
			stage = 'wizard';
			return;
		}
		clean.id = slugifyId(titleText) || 'trip';
		const check = validateTripDoc(clean);
		if (!check.valid) {
			createError = check.errors;
			stage = 'wizard';
			return;
		}
		try {
			const res = await fetch('/api/trips', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(clean)
			});
			if (!res.ok) {
				const e = (await res.json()) as { error?: string; details?: string[] };
				createError = e.details ?? [e.error ?? t('editor.errSaveFailed', { status: res.status })];
				stage = 'wizard';
				return;
			}
			const created = (await res.json()) as { id: string };
			await goto(`/trips/${created.id}?edit=1`);
		} catch {
			createError = [t('editor.errNetworkSave')];
			stage = 'wizard';
		}
	}
</script>

<svelte:head>
	<title>{t('wizard.pageTitle')}</title>
</svelte:head>

{#if stage === 'wizard'}
	{#if createError.length}
		<div class="create-error" role="alert">
			<strong>{t('editor.pleaseFix')}</strong>
			<ul>{#each createError as e (e)}<li>{e}</li>{/each}</ul>
		</div>
	{/if}
	<CreationWizard {onCreate} onBlank={() => (stage = 'blank')} />
{:else if stage === 'blank'}
	<TripEditor initial={null} mode="new" />
{:else}
	<p class="creating">{t('editor.saving')}</p>
{/if}

<BottomBar user={data.user} items={[{ id: 'trips', label: t('nav.trips'), icon: 'trips', href: '/' }]} />

<style>
	.creating {
		text-align: center;
		padding: 3rem 1rem;
		color: var(--text-muted);
		font-family: var(--font-ui);
	}
	.create-error {
		max-width: 640px;
		margin: 1rem auto 0;
		padding: 0.6rem 0.9rem;
		border-radius: var(--radius-md);
		border-left: 2.5px solid var(--warn-bar);
		background: var(--warn-bg);
		color: var(--warn-fg);
		font-family: var(--font-ui);
		font-size: 0.82rem;
	}
	.create-error ul {
		margin: 0.3rem 0 0;
		padding-left: 1.1rem;
	}
</style>
