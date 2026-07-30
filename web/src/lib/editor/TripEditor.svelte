<script lang="ts">
	import { untrack } from 'svelte';
	import { goto, beforeNavigate } from '$app/navigation';
	import type { Trip, Segment } from '$lib/trip-engine';
	import TripView from '$lib/TripView.svelte';
	import SegmentEditor from './SegmentEditor.svelte';
	import TripSettingsFields from './TripSettingsFields.svelte';
	import { blankTrip, blankSegment, move, removeAt, pruneEmpty, nextId, slugifyId } from './factories';
	import { dndzone, dndId, fromItems, grabHandle, FLIP_MS } from './dnd';
	import { validateTripDoc, type TripDoc } from '$lib/validateTrip';
	import { t } from '$lib/i18n/store.svelte';
	import ConfirmDialog from '$lib/dialog/ConfirmDialog.svelte';
	import { toast } from '$lib/toast';

	let {
		initial,
		mode,
		tripId,
		baseUpdatedAt
	}: { initial: Trip | null; mode: 'new' | 'edit'; tripId?: string; baseUpdatedAt?: string } =
		$props();

	let draft = $state<Trip>(
		untrack(() => (initial ? (structuredClone($state.snapshot(initial)) as Trip) : blankTrip()))
	);
	let errors = $state<string[]>([]);
	let saving = $state(false);

	// Optimistic-concurrency base version, rebased after each successful save.
	let base = $state<string | undefined>(untrack(() => baseUpdatedAt));

	// ── Dirty guard: warn before losing unsaved edits ──
	// Serialize the same way save() does so cosmetic differences don't read as dirty.
	function serialize(): string {
		return JSON.stringify(pruneEmpty($state.snapshot(draft)) ?? null);
	}
	let savedSnapshot = $state(untrack(serialize));
	let justSaved = $state(false);
	const dirty = $derived(!justSaved && serialize() !== savedSnapshot);

	// Styled replacement for the native confirm() (Phase 3 task 3). A SPA
	// navigation is cancelled up front, then re-issued with goto() if the
	// user confirms the discard; browser-close/reload ("leave" navigations,
	// where nav.to is null) fall through to the native beforeunload prompt
	// below instead, since there's no in-app dialog that can block a tab close.
	let discardOpen = $state(false);
	let pendingNavHref: string | null = null;
	// Guard bypass for the confirmed-discard goto(): `dirty` is still true when
	// confirmDiscard() re-issues the navigation, so without this flag the guard
	// below would cancel its own re-issued goto() and re-open the dialog (or
	// silently strand the user on the page, depending on effect timing) —
	// mirroring how save() passes through via `justSaved`.
	let bypassGuard = false;
	beforeNavigate((nav) => {
		if (bypassGuard) {
			bypassGuard = false;
			return;
		}
		if (!dirty) return;
		if (!nav.to) return; // "leave" navigation — beforeunload handles this
		nav.cancel();
		pendingNavHref = nav.to.url.href;
		discardOpen = true;
	});
	function confirmDiscard() {
		const href = pendingNavHref;
		pendingNavHref = null;
		if (href) {
			bypassGuard = true;
			// Reset the flag once the navigation settles either way, so a failed
			// goto() can't leave a stale bypass that lets a later dirty-nav slip.
			goto(href).finally(() => {
				bypassGuard = false;
			});
		}
	}
	function cancelDiscard() {
		pendingNavHref = null;
	}
	$effect(() => {
		if (!dirty) return;
		const handler = (e: BeforeUnloadEvent) => e.preventDefault();
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	});

	const langs = $derived(draft.languages);


	// Auto-expand + focus the most recently added segment.
	let justAddedSeg = $state<Segment | null>(null);
	function addSegment() {
		const seg = blankSegment(langs, nextId('segment', draft.segments.map((s) => s.id)));
		seg.id = ''; // let the auto-slug fill it from the title the user types
		draft.segments.push(seg);
		// Read the element back so the identity matches the reactive proxy the
		// template sees (Svelte wraps inserted objects), so autoOpen resolves.
		justAddedSeg = draft.segments[draft.segments.length - 1];
		syncSegs();
	}

	// New segment's weather timezone defaults to the previous segment's (else the
	// first segment's, else Europe/London), so a multi-city trip stays consistent.
	function defaultTz(seg: Segment): string {
		const i = draft.segments.indexOf(seg);
		return (
			draft.segments[i - 1]?.weather?.timezone ||
			draft.segments[0]?.weather?.timezone ||
			'Europe/London'
		);
	}

	// ── Drag reorder for segments within the trip (handle-initiated) ──
	// See DayEditor for the state/effect rationale.
	type SegItem = { id: string; item: Segment };
	let segDragDisabled = $state(true);
	const wrapSeg = (s: Segment): SegItem => ({ id: dndId(s), item: s });
	let segItems = $state<SegItem[]>(untrack(() => draft.segments.map(wrapSeg)));
	// Rebuild the wrapped list from the model; called imperatively after add/
	// remove/move, since in-place array mutations don't reliably re-fire the sync
	// effect below.
	function syncSegs() {
		segItems = draft.segments.map(wrapSeg);
	}
	$effect(() => {
		const modelIds = draft.segments.map(dndId).join('|');
		untrack(() => {
			if (segItems.map((w) => w.id).join('|') !== modelIds) segItems = draft.segments.map(wrapSeg);
		});
	});
	function considerSegs(e: CustomEvent<{ items: SegItem[] }>) {
		segItems = e.detail.items;
	}
	function finalizeSegs(e: CustomEvent<{ items: SegItem[] }>) {
		segItems = e.detail.items;
		draft.segments = fromItems(e.detail.items);
		segDragDisabled = true;
	}
	function grabSeg() {
		grabHandle((v) => (segDragDisabled = v));
	}
	function segIdx(s: Segment): number {
		return draft.segments.indexOf(s);
	}

	// The live preview renders TripView only once the draft has something to show:
	// any day with a date, or any trip title text. A brand-new blank draft (one
	// empty segment/day) otherwise renders as a broken empty hero, so we show a
	// quiet placeholder card until real content exists.
	const hasPreviewContent = $derived.by(() => {
		const anyTitle = Object.values(draft.title ?? {}).some((v) => !!v && v.trim() !== '');
		if (anyTitle) return true;
		return draft.segments.some((s) =>
			s.plans.some((p) => p.days.some((d) => !!d.date && d.date.trim() !== ''))
		);
	});



	async function save() {
		errors = [];
		const clean = pruneEmpty($state.snapshot(draft)) as TripDoc | undefined;
		if (!clean) {
			errors = [t('editor.errTripEmpty')];
			return;
		}
		// On the create path the client must supply a schema-valid `id` or the
		// validator rejects the doc before it ever reaches the server (which would
		// otherwise slugify the title itself). Derive it here, mirroring the
		// server's slugify; the server still dedupes across existing trips.
		if (mode === 'new') {
			const titleText = (clean.title?.[clean.defaultLanguage] ?? '').trim();
			if (!titleText) {
				errors = [t('editor.errGiveTitle')];
				return;
			}
			clean.id = slugifyId(titleText) || 'trip';
		}
		const check = validateTripDoc(clean);
		if (!check.valid) {
			errors = check.errors;
			return;
		}
		saving = true;
		try {
			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			if (mode === 'edit' && base) headers['x-base-updated-at'] = base;
			const res = await fetch(mode === 'new' ? '/api/trips' : `/api/trips/${tripId}`, {
				method: mode === 'new' ? 'POST' : 'PUT',
				headers,
				body: JSON.stringify(clean)
			});
			if (res.ok) {
				const data = (await res.json()) as { id: string; updatedAt?: string };
				// Rebase the version and snapshot so consecutive saves work and the
				// dirty guard doesn't prompt on the post-save navigation.
				if (data.updatedAt) base = data.updatedAt;
				savedSnapshot = serialize();
				justSaved = true;
				toast(t('toast.tripSaved'));
				await goto(`/trips/${data.id}`);
			} else {
				const e = (await res.json()) as { error?: string; details?: string[] };
				errors = e.details ?? [e.error ?? t('editor.errSaveFailed', { status: res.status })];
			}
		} catch {
			errors = [t('editor.errNetworkSave')];
		} finally {
			saving = false;
		}
	}
</script>

<div class="editor">
	<div class="form">
		<div class="bar">
			<a class="back" href={mode === 'edit' ? `/trips/${tripId}` : '/'}>{t('editor.cancel')}</a>
			<button class="save" onclick={save} disabled={saving}>{saving ? t('editor.saving') : t('editor.saveTrip')}</button>
		</div>

		{#if errors.length}
			<div class="errors">
				<strong>{t('editor.pleaseFix')}</strong>
				<ul>{#each errors as e (e)}<li>{e}</li>{/each}</ul>
			</div>
		{/if}

		<details class="settings" open>
			<summary>{t('editor.tripSettings')}</summary>
			<div class="sbody">
				<!-- Shared with the settings drawer on the trip page (Phase 5): this form
				     saves explicitly, so no onedit callback is passed. -->
				<TripSettingsFields trip={draft} />
			</div>
		</details>

		<div class="segs-hd"><h2>{t('editor.segments')}</h2><button type="button" onclick={addSegment}>{t('editor.addSegment')}</button></div>
		<div
			class="dndlist"
			use:dndzone={{ items: segItems, flipDurationMs: FLIP_MS, dragDisabled: segDragDisabled, dropTargetStyle: {} }}
			onconsider={considerSegs}
			onfinalize={finalizeSegs}
		>
			{#each segItems as w (w.id)}
				<SegmentEditor
					bind:segment={w.item}
					{langs}
					tags={draft.tags}
					defaultTimezone={defaultTz(w.item)}
					autoOpen={w.item === justAddedSeg}
					canUp={segIdx(w.item) > 0}
					canDown={segIdx(w.item) < draft.segments.length - 1}
					onMove={(dir) => { move(draft.segments, segIdx(w.item), dir); syncSegs(); }}
					onRemove={() => { removeAt(draft.segments, segIdx(w.item)); syncSegs(); }}
					onGrab={grabSeg}
				/>
			{/each}
		</div>
	</div>

	<div class="preview">
		<div class="preview-label">{t('editor.livePreview')}</div>
		{#if hasPreviewContent}
			{#key draft.languages.length}
				<TripView trip={draft} />
			{/key}
		{:else}
			<div class="preview-empty">{t('editor.previewPlaceholder')}</div>
		{/if}
	</div>
</div>

<ConfirmDialog
	bind:open={discardOpen}
	title={t('editor.discardTitle')}
	body={t('editor.discardConfirm')}
	cancelLabel={t('common.cancel')}
	confirmLabel={t('dialog.discard')}
	onconfirm={confirmDiscard}
	oncancel={cancelDiscard}
/>

<style>
	.editor {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem 1.5rem 3rem;
		font-family: var(--font-ui);
	}
	.form {
		min-width: 0;
	}
	@media (min-width: 1024px) {
		.editor {
			display: grid;
			grid-template-columns: minmax(560px, 1fr) 430px;
			gap: 2rem;
			align-items: start;
		}
	}
	.bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
		position: sticky;
		top: 0;
		background: var(--bg);
		padding: 0.5rem 0;
		z-index: 2;
	}
	.back {
		text-decoration: none;
		color: var(--accent-strong);
		font-size: 0.9rem;
	}
	.save {
		font: inherit;
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: var(--radius-button);
		padding: 0.5rem 1.2rem;
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.5;
	}
	.errors {
		background: var(--pill-bug-bg);
		border: 1px solid var(--pill-bug-bg);
		border-radius: var(--radius-md);
		padding: 0.6rem 0.8rem;
		margin-bottom: 0.75rem;
		font-size: 0.85rem;
		color: var(--pill-bug-fg);
	}
	.errors ul {
		margin: 0.3rem 0 0 1rem;
	}
	.settings {
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-lg);
		margin-bottom: 1rem;
		background: var(--surface);
	}
	.settings > summary {
		padding: 0.6rem 0.8rem;
		cursor: pointer;
		font-weight: 700;
	}
	.sbody {
		padding: 0.7rem 0.8rem;
		border-top: 1px solid var(--hairline);
	}
	.segs-hd {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin: 0.5rem 0 0.75rem;
	}
	h2 {
		font-size: 1.05rem;
	}
	button {
		font: inherit;
		font-size: 0.82rem;
		border: 1px solid var(--hairline-strong);
		background: var(--surface);
		border-radius: var(--radius-button);
		padding: 0.25rem 0.6rem;
		cursor: pointer;
	}
	.preview {
		margin-top: 1.5rem;
	}
	.preview-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
		margin-bottom: 0.5rem;
		text-align: center;
	}
	.preview-empty {
		max-width: 430px;
		margin: 0 auto;
		border: 1px dashed var(--hairline-strong);
		border-radius: var(--radius-lg);
		background: var(--surface);
		color: var(--text-muted);
		font-size: 0.85rem;
		text-align: center;
		padding: 3.5rem 1.5rem;
	}
	@media (min-width: 1024px) {
		.preview {
			position: sticky;
			top: 16px;
			margin-top: 0;
		}
		.preview-empty {
			padding: 5rem 1.5rem;
		}
	}
</style>
