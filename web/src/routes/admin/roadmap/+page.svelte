<script lang="ts">
	import BottomBar from '$lib/nav/BottomBar.svelte';
	import { locale, t } from '$lib/i18n/store.svelte';
	import type { Messages } from '$lib/i18n';
	import type { FeedbackAdminRow } from '$lib/feedback';
	import type { RoadmapStatus } from '$lib/roadmap/types';
	import { ROADMAP_TITLE_MAX_LEN, ROADMAP_NOTE_MAX_LEN } from '$lib/roadmap/limits';
	import EmptyState from '$lib/ui/empty/EmptyState.svelte';

	let { data, form } = $props();

	const STATUSES: RoadmapStatus[] = ['planned', 'building', 'shipped'];

	const TYPE_KEY: Record<string, keyof Messages> = {
		bug: 'feedback.typeBug',
		idea: 'feedback.typeIdea',
		other: 'feedback.typeOther'
	};
	const STATUS_KEY: Record<RoadmapStatus, keyof Messages> = {
		shipped: 'roadmap.statusShipped',
		building: 'roadmap.statusBuilding',
		planned: 'roadmap.statusPlanned'
	};

	function formatDateTime(ms: number): string {
		return new Intl.DateTimeFormat(locale(), {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(ms));
	}

	/** Seed both title fields from the submission so the common case is "tidy
	 *  the wording, translate the other half, publish" rather than typing twice
	 *  from scratch. */
	function seedTitle(message: string): string {
		const oneLine = message.replace(/\s+/g, ' ').trim();
		return oneLine.length > ROADMAP_TITLE_MAX_LEN
			? oneLine.slice(0, ROADMAP_TITLE_MAX_LEN - 1) + '…'
			: oneLine;
	}

	function submitter(row: FeedbackAdminRow): string {
		return row.userName ?? row.userEmail;
	}

	const errorKey = $derived(form?.errorKey as keyof Messages | undefined);
</script>

<svelte:head>
	<title>{t('admin.roadmap.pageTitle')}</title>
</svelte:head>

<main>
	<a class="back" href="/">{t('feedback.back')}</a>
	<div class="head-row">
		<h1>{t('admin.roadmap.heading')}</h1>
		<a class="side-link" href="/admin/approvals">{t('feedback.adminApprovalsLink')}</a>
	</div>
	<p class="intro">{t('admin.roadmap.intro')}</p>

	<section>
		<h2>{t('admin.roadmap.queueHeading')}</h2>
		{#if data.queue.length === 0}
			<EmptyState kind="inbox"><p>{t('admin.roadmap.queueEmpty')}</p></EmptyState>
		{:else}
			<ul class="list">
				{#each data.queue as row (row.id)}
					<li class="card">
						<div class="meta">
							<span class="chip type">{t(TYPE_KEY[row.type] ?? 'feedback.typeOther')}</span>
							<span class="who">{submitter(row)}</span>
							<span class="date">{formatDateTime(row.createdAt)}</span>
							{#if row.page}<span class="page">{row.page}</span>{/if}
						</div>
						<p class="message">{row.message}</p>

						{#if errorKey && form?.feedbackId === row.id}
							<p class="error">{t(errorKey)}</p>
						{/if}

						<div class="row-actions">
							<details open={form?.feedbackId === row.id}>
								<summary>{t('admin.roadmap.acceptToggle')}</summary>
								<form method="POST" action="?/accept" class="accept-form">
									<input type="hidden" name="feedbackId" value={row.id} />

									<label>
										<span>{t('admin.roadmap.titleEn')}</span>
										<input
											name="titleEn"
											value={seedTitle(row.message)}
											maxlength={ROADMAP_TITLE_MAX_LEN}
											required
										/>
									</label>
									<label>
										<span>{t('admin.roadmap.titlePt')}</span>
										<input
											name="titlePt"
											value={seedTitle(row.message)}
											maxlength={ROADMAP_TITLE_MAX_LEN}
											required
										/>
									</label>

									<label>
										<span>{t('admin.roadmap.status')}</span>
										<select name="status">
											{#each STATUSES as status (status)}
												<option value={status}>{t(STATUS_KEY[status])}</option>
											{/each}
										</select>
									</label>

									<label>
										<span>{t('admin.roadmap.noteEn')}</span>
										<textarea name="noteEn" rows="2" maxlength={ROADMAP_NOTE_MAX_LEN}></textarea>
									</label>
									<label>
										<span>{t('admin.roadmap.notePt')}</span>
										<textarea name="notePt" rows="2" maxlength={ROADMAP_NOTE_MAX_LEN}></textarea>
									</label>

									<p class="hint">{t('admin.roadmap.bilingualHint')}</p>
									<button type="submit" class="primary">{t('admin.roadmap.publish')}</button>
								</form>
							</details>

							<form method="POST" action="?/dismiss">
								<input type="hidden" name="feedbackId" value={row.id} />
								<button type="submit" class="quiet">{t('admin.roadmap.dismiss')}</button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h2>{t('admin.roadmap.entriesHeading')}</h2>
		<ul class="list">
			{#each data.items as item (item.id)}
				<li class="card entry" class:retired={item.hidden}>
					<div class="entry-text">
						<span class="entry-title">{item.title.en}</span>
						<span class="entry-sub">
							{item.title.pt}
							<span class="chip source">{t(item.source === 'base'
								? 'admin.roadmap.sourceBase'
								: 'admin.roadmap.sourceOverlay')}</span>
							{#if item.hidden}<span class="chip retired-chip">{t('admin.roadmap.retired')}</span>{/if}
						</span>
					</div>

					{#if errorKey && form?.itemId === item.id}
						<p class="error">{t(errorKey)}</p>
					{/if}

					<div class="row-actions">
						<form method="POST" action="?/patch" class="inline">
							<input type="hidden" name="id" value={item.id} />
							<select name="status" aria-label={t('admin.roadmap.status')}>
								{#each STATUSES as status (status)}
									<option value={status} selected={item.status === status}>
										{t(STATUS_KEY[status])}
									</option>
								{/each}
							</select>
							<button type="submit" class="quiet">{t('admin.roadmap.save')}</button>
						</form>

						<form method="POST" action="?/patch" class="inline">
							<input type="hidden" name="id" value={item.id} />
							<input type="hidden" name="hidden" value={item.hidden ? '0' : '1'} />
							<button type="submit" class="quiet">
								{item.hidden ? t('admin.roadmap.restore') : t('admin.roadmap.retire')}
							</button>
						</form>

						{#if item.source === 'overlay'}
							<form method="POST" action="?/revert" class="inline">
								<input type="hidden" name="id" value={item.id} />
								<button type="submit" class="quiet">{t('admin.roadmap.revert')}</button>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>
</main>

<BottomBar user={data.user} items={[{ id: 'trips', label: t('nav.trips'), icon: 'trips', href: '/' }]} />

<style>
	main {
		font-family: var(--font-ui);
		max-width: 760px;
		margin: 2rem auto;
		padding: 0 1.5rem 4rem;
		color: var(--text);
	}
	.back {
		font-size: 0.8rem;
		text-decoration: none;
		color: var(--text-muted);
	}
	.head-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	h1 {
		font-size: var(--type-h1);
		margin: 0.5rem 0 0.25rem;
	}
	.side-link {
		font-size: 0.82rem;
		color: var(--text-muted);
	}
	.intro {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin: 0 0 1.5rem;
	}
	section {
		margin-bottom: 2rem;
	}
	h2 {
		font-size: 1.05rem;
		margin: 0 0 0.75rem;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		padding: 0.8rem 0.9rem;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.chip {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.45rem;
		border-radius: var(--radius-pill);
		background: var(--pill-neutral-bg);
		color: var(--pill-neutral-fg);
	}
	.page {
		font-family: var(--font-mono, monospace);
	}
	.message {
		margin: 0.5rem 0 0.7rem;
		font-size: 0.9rem;
		white-space: pre-wrap;
	}
	.row-actions {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.row-actions form {
		margin: 0;
	}
	.inline {
		display: flex;
		gap: 0.35rem;
	}
	details {
		flex: 1 1 20rem;
	}
	summary {
		cursor: pointer;
		font-size: 0.82rem;
		color: var(--text-muted);
	}
	.accept-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	input,
	select,
	textarea {
		font: inherit;
		font-size: 0.85rem;
		color: var(--text);
		background: var(--surface-sunken, var(--surface));
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-button);
		padding: 0.35rem 0.5rem;
	}
	textarea {
		resize: vertical;
	}
	.hint {
		font-size: 0.72rem;
		color: var(--text-muted);
		margin: 0;
	}
	.error {
		font-size: 0.8rem;
		color: var(--pill-warn-fg);
		background: var(--pill-warn-bg);
		border-radius: var(--radius-button);
		padding: 0.35rem 0.5rem;
		margin: 0.5rem 0;
	}
	button {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.4rem 0.8rem;
		border-radius: var(--radius-button);
		cursor: pointer;
		border: 1px solid var(--hairline-strong);
		background: var(--surface);
		color: var(--text);
	}
	.primary {
		align-self: flex-start;
		border-color: transparent;
		background: var(--pill-go-bg);
		color: var(--pill-go-fg);
	}
	button:hover {
		filter: brightness(0.95);
	}
	.entry {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.entry.retired .entry-title {
		text-decoration: line-through;
		color: var(--text-muted);
	}
	.entry-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1 1 18rem;
	}
	.entry-title {
		font-weight: 600;
		font-size: 0.9rem;
	}
	.entry-sub {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		font-size: 0.78rem;
		color: var(--text-muted);
	}
	.retired-chip {
		background: var(--pill-warn-bg);
		color: var(--pill-warn-fg);
	}
</style>
