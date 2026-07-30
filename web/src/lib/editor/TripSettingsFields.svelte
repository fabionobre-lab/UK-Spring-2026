<script lang="ts">
	// Trip-level settings: the fields that describe the whole trip rather than
	// any one day or stop — title, eyebrow, languages, locale, money, home base
	// and the tag vocabulary.
	//
	// Extracted from TripEditor in Phase 5 so the same implementation backs both
	// the form editor and the settings drawer on the trip page. It mutates the
	// trip it is given in place and reports changes through `onedit`, so the
	// drawer can autosave while the form editor (which has its own Save button)
	// simply omits the callback.
	import { untrack } from 'svelte';
	import type { Trip } from '$lib/trip-engine';
	import { slugifyId } from './factories';
	import LocalizedInput from './LocalizedInput.svelte';
	import PlaceSearch from './PlaceSearch.svelte';
	import { t } from '$lib/i18n/store.svelte';

	let {
		trip,
		onedit
	}: {
		trip: Trip;
		/** Fired after any change, so an autosaving host can persist it. */
		onedit?: (structural?: boolean) => void;
	} = $props();

	const langs = $derived(trip.languages);

	// Any bubbling `input` means a bound field wrote to the model — one listener
	// beats wiring every control. Button-driven changes call notify() directly.
	function notify() {
		onedit?.();
	}

	// ── Languages ──
	let langFormOpen = $state(false);
	let langInput = $state('');
	let langErr = $state('');
	function submitLanguage() {
		const code = langInput.trim().toLowerCase();
		if (code.length < 2) return (langErr = t('editor.errLangCode'));
		if (trip.languages.includes(code)) return (langErr = t('editor.errLangDup', { code }));
		trip.languages.push(code);
		langInput = '';
		langErr = '';
		langFormOpen = false;
		onedit?.(true);
	}
	function removeLanguage(code: string) {
		if (trip.languages.length <= 1) return;
		trip.languages = trip.languages.filter((l) => l !== code);
		if (trip.defaultLanguage === code) trip.defaultLanguage = trip.languages[0];
		onedit?.(true);
	}

	// Stored as an upper-case ISO 4217 code (schema pattern ^[A-Z]{3}$);
	// normalise as the user types and clear on empty so a blank field prunes
	// away rather than failing validation.
	function setCurrency(raw: string) {
		const v = raw.trim().toUpperCase();
		trip.currency = v === '' ? undefined : v;
		onedit?.();
	}

	const hasHome = $derived(!!trip.home);
	function toggleHome(on: boolean) {
		trip.home = on ? { name: '', postcode: '', lat: 0, lon: 0 } : undefined;
		onedit?.(true);
	}
	function onPickHome(p: { name: string; lat: number; lon: number }) {
		if (!trip.home) return;
		if (!trip.home.name) trip.home.name = p.name;
		trip.home.lat = p.lat;
		trip.home.lon = p.lon;
		onedit?.();
	}

	// ── Tag vocabulary ──
	// The author edits the visible Label; the key auto-slugs from it until they
	// edit the key themselves.
	let tagFormOpen = $state(false);
	let tagLabel = $state('');
	let tagKey = $state('');
	let tagKeyDirty = $state(false);
	let tagErr = $state('');
	$effect(() => {
		const label = tagLabel;
		if (!tagKeyDirty) untrack(() => (tagKey = slugifyId(label)));
	});
	function openTagForm() {
		tagFormOpen = true;
		tagLabel = '';
		tagKey = '';
		tagKeyDirty = false;
		tagErr = '';
	}
	function submitTag() {
		const label = tagLabel.trim();
		const key = tagKey.trim();
		if (!label) return (tagErr = t('editor.errTagLabel'));
		if (!key || !/^[a-z0-9][a-z0-9_-]*$/.test(key)) return (tagErr = t('editor.errTagKey'));
		if (trip.tags?.[key]) return (tagErr = t('editor.errTagKeyDup', { key }));
		trip.tags ??= {};
		trip.tags[key] = {
			label: Object.fromEntries(langs.map((l) => [l, l === trip.defaultLanguage ? label : ''])),
			style: 'sight'
		};
		tagFormOpen = false;
		onedit?.(true);
	}
	function removeTag(key: string) {
		if (!trip.tags) return;
		delete trip.tags[key];
		onedit?.(true);
	}
	const tagKeys = $derived(trip.tags ? Object.keys(trip.tags) : []);
</script>

<div class="sfields" oninput={notify}>
	<LocalizedInput bind:value={trip.title} {langs} label={t('editor.tripTitle')} />
	<LocalizedInput bind:value={trip.eyebrow as never} {langs} label={t('editor.eyebrow')} />

	<div class="langs">
		<span class="lbl">{t('editor.languages')}</span>
		<div class="chips">
			{#each trip.languages as l (l)}
				<span class="chip">{l}{#if trip.languages.length > 1}<button type="button" onclick={() => removeLanguage(l)}>✕</button>{/if}</span>
			{/each}
			{#if !langFormOpen}
				<button type="button" class="add" onclick={() => { langFormOpen = true; langErr = ''; }}>{t('editor.addLanguage')}</button>
			{/if}
		</div>
		{#if langFormOpen}
			<div class="miniform">
				<input
					type="text"
					placeholder={t('editor.langCodePlaceholder')}
					bind:value={langInput}
					onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), submitLanguage())}
					aria-label={t('editor.newLangCodeAria')}
				/>
				<button type="button" class="add" onclick={submitLanguage}>{t('common.add')}</button>
				<button type="button" onclick={() => { langFormOpen = false; langInput = ''; langErr = ''; }}>{t('common.cancel')}</button>
				{#if langErr}<span class="minierr">{langErr}</span>{/if}
			</div>
		{/if}
		<label class="f inline">{t('editor.default')}
			<select bind:value={trip.defaultLanguage} onchange={() => onedit?.(true)}>
				{#each trip.languages as l (l)}<option value={l}>{l}</option>{/each}
			</select>
		</label>
	</div>

	<LocalizedInput bind:value={trip.locales as never} {langs} label={t('editor.locale')} placeholder="en-GB" />

	<div class="grid2 money">
		<label class="f">{t('editor.currency')}<input type="text" maxlength="3" placeholder="GBP" value={trip.currency ?? ''} oninput={(e) => setCurrency(e.currentTarget.value)} /></label>
		<label class="f">{t('editor.budget')}<input type="number" min="0" step="any" placeholder="0" bind:value={trip.budget} /></label>
	</div>

	<div class="homebase">
		<label class="check"><input type="checkbox" checked={hasHome} onchange={(e) => toggleHome(e.currentTarget.checked)} /> {t('editor.homeBase')}</label>
		{#if trip.home}
			<PlaceSearch label={t('editor.findPlace')} onPick={onPickHome} />
			<div class="grid4">
				<label class="f">{t('editor.name')}<input type="text" bind:value={trip.home.name} /></label>
				<label class="f">{t('editor.postcode')}<input type="text" bind:value={trip.home.postcode} /></label>
				<label class="f">{t('editor.lat')}<input type="number" step="0.0001" bind:value={trip.home.lat} /></label>
				<label class="f">{t('editor.lon')}<input type="number" step="0.0001" bind:value={trip.home.lon} /></label>
			</div>
		{/if}
	</div>

	<div class="tagsvocab">
		<div class="sub-hd"><span class="lbl">{t('editor.tagVocabulary')}</span>
			{#if !tagFormOpen}<button type="button" onclick={openTagForm}>{t('editor.addTag')}</button>{/if}
		</div>
		{#if tagFormOpen}
			<div class="miniform tagform">
				<label class="f">{t('editor.label')}<input type="text" bind:value={tagLabel} placeholder={t('editor.tagLabelPlaceholder')} aria-label={t('editor.newTagLabelAria')} /></label>
				<label class="f keyf">{t('editor.key')} <span class="hint">{t('editor.auto')}</span>
					<input type="text" bind:value={tagKey} oninput={() => (tagKeyDirty = true)} aria-label={t('editor.newTagKeyAria')} />
				</label>
				<button type="button" class="add" onclick={submitTag}>{t('common.add')}</button>
				<button type="button" onclick={() => (tagFormOpen = false)}>{t('common.cancel')}</button>
				{#if tagErr}<span class="minierr">{tagErr}</span>{/if}
			</div>
		{/if}
		{#each tagKeys as key (key)}
			<div class="tagrow">
				<span class="tkey">{key}</span>
				<LocalizedInput bind:value={trip.tags![key].label} {langs} label={t('editor.label')} />
				<select bind:value={trip.tags![key].style} onchange={() => onedit?.()} aria-label={t('editor.tagStyleAria')}>
					{#each ['sight', 'food', 'birthday', 'booking', 'logistics', 'fullday'] as s (s)}<option value={s}>{s}</option>{/each}
				</select>
				<button type="button" class="del" onclick={() => removeTag(key)}>✕</button>
			</div>
		{/each}
	</div>
</div>

<style>
	.langs {
		margin: 0.5rem 0;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
		margin: 0.3rem 0;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		background: var(--surface-sunken);
		border-radius: var(--radius-pill);
		padding: 0.2rem 0.6rem;
		font-size: 0.8rem;
	}
	.chip button {
		border: none;
		background: none;
		cursor: pointer;
		color: var(--pill-bug-fg);
		padding: 0;
		font-size: 0.75rem;
	}
	.lbl {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		font-weight: 600;
	}
	.f {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.f.inline {
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.3rem;
	}
	.f input,
	.f select {
		font: inherit;
		font-size: 0.85rem;
		text-transform: none;
		letter-spacing: normal;
		background: var(--surface);
		color: var(--text);
		min-width: 0;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-md);
	}
	.homebase {
		margin-top: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px dashed var(--hairline);
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: var(--text-muted);
		margin: 0.3rem 0 0.5rem;
	}
	.grid4 {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.grid2 {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.money {
		margin-top: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px dashed var(--hairline);
	}
	select {
		font: inherit;
		font-size: 0.85rem;
		background: var(--surface);
		color: var(--text);
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-md);
	}
	.tagsvocab {
		margin-top: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px dashed var(--hairline);
	}
	.miniform {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.4rem;
		margin: 0.3rem 0 0.5rem;
	}
	.miniform input {
		font: inherit;
		font-size: 0.85rem;
		background: var(--surface);
		color: var(--text);
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-md);
	}
	.miniform .keyf .hint {
		font-size: 0.6rem;
		color: var(--text-muted);
		text-transform: none;
		letter-spacing: normal;
	}
	.minierr {
		flex-basis: 100%;
		font-size: 0.75rem;
		color: var(--pill-bug-fg);
	}
	.sub-hd {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.4rem;
	}
	.tagrow {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		margin-bottom: 0.4rem;
	}
	.tkey {
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
		background: var(--surface-sunken);
		border-radius: var(--radius-sm);
		padding: 0.3rem 0.4rem;
		margin-top: 0.3rem;
	}
	.del {
		border: none;
		background: none;
		cursor: pointer;
		color: var(--pill-bug-fg);
		font-size: 0.85rem;
	}
</style>
