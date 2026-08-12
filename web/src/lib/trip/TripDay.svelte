<script lang="ts">
	// One day of the itinerary: the theme-coloured day header (date, title, note,
	// weather/km/cost row, birthday banner), the map + Day-Route aside, the
	// timeline of blocks, the day-level photo strip, and the segment footer.
	//
	// This is the `.day-content` grid — on desktop a two-column layout whose left
	// column flows (header → timeline → photos → footer) beside a sticky right
	// column (map, then route card). Extracted verbatim from TripView; the keyed
	// day-switch entry animation lives on this component's parts (see the
	// day-part-in keyframes in the style block).
	//
	// Anything derivable from `trip`/`lang`/`day` is derived here; state owned by
	// TripView (the weather cache, wiki thumbnails, checklist persistence, the
	// lightbox) arrives as props.
	import { untrack } from 'svelte';
	import { blankBlock, move as moveInArray } from '$lib/editor/factories';
	import { dndzone, dndId, fromItems, grabHandle, FLIP_MS } from '$lib/editor/dnd';
	import { t } from '$lib/i18n/store.svelte';
	import { toast, dismissToast } from '$lib/toast';
	import type { Block } from '$lib/trip-engine';
	import {
		type Trip,
		type Segment,
		type Plan,
		type Day,
		type PhotoSpot,
		type ChecklistItem,
		loc,
		localeFor,
		dayLabel,
		tripIsPast,
		type RoutePlace,
		dayKmTotal,
		dayCostTotal
	} from '$lib/trip-engine';
	import DayMap, { type MapStop, type PhotoStop } from '$lib/DayMap.svelte';
	import { tripChrome } from '$lib/i18n/tripChrome';
	import { formatTemp, walkMinutes, formatMoney } from '$lib/format';
	import { isOnline } from '$lib/online.svelte';
	import { type TripPhoto } from '$lib/photos';
	import TripBlock from './TripBlock.svelte';
	import NowMarker from './NowMarker.svelte';
	import PhotoStrip from './PhotoStrip.svelte';
	import EditableText from './EditableText.svelte';
	import DayInspector from './DayInspector.svelte';
	import Tip from '$lib/Tip.svelte';

	let {
		trip,
		lang,
		seg,
		plan,
		day,
		dir = 1,
		wx = null,
		isToday = false,
		nowMarkerIdx = null,
		nowLabel,
		nowMarkerEl = $bindable(null),
		mapStops = [],
		photoMapStops = [],
		routeForDay = null,
		stopNums = [],
		badgeFor,
		photosByBlock,
		dayLevelPhotos = [],
		photoToken,
		spotImg,
		checklistDone,
		onToggleChecklist,
		onopenlightbox,
		onphotostopclick,
		edit = false,
		onedit,
		onundo,
		dayPhotoCount = 0,
		ondayinsert,
		ondayduplicate,
		ondayremove,
		ondaymove,
		canDayMoveUp = false,
		canDayMoveDown = false,
		canDayRemove = false
	}: {
		trip: Trip;
		lang: string;
		seg: Segment;
		plan: Plan;
		day: Day;
		/** Direction the day body slides in from: +1 when moving forward through
		 *  the trip, -1 when moving back. Set by every navigation route in
		 *  TripView (swipe, date strip, desktop rail) so the motion answers the
		 *  gesture instead of playing the same way in both directions. */
		dir?: 1 | -1;
		/** Day weather summary from TripView's fetch cache, or null. */
		wx?: { emoji: string; hi: number; lo: number } | null;
		isToday?: boolean;
		/** Index the "now" marker sits before, `blocks.length` for after the last
		 *  block, or null when today isn't this day. */
		nowMarkerIdx?: number | null;
		/** Current time as HH:MM in the trip's timezone; composed with the trip
		 *  language's "Now" into the marker's label. */
		nowLabel: string;
		/** The rendered marker element, so TripView can scroll it into view. */
		nowMarkerEl?: HTMLDivElement | null;
		mapStops?: MapStop[];
		photoMapStops?: PhotoStop[];
		routeForDay?: { url: string; places: RoutePlace[] } | null;
		/** Shared stop number per block index (null where the block has neither
		 *  coordinates nor a Maps link), so the timeline dot, the map pin and the
		 *  Day-Route stepper all label the same place with the same number. */
		stopNums?: (number | null)[];
		/** Weather badge for a block's time, from TripView's fetch cache. */
		badgeFor: (time: string) => { emoji: string; temp: number } | null;
		photosByBlock: Map<number, TripPhoto[]>;
		dayLevelPhotos?: TripPhoto[];
		photoToken?: string;
		spotImg: (spot: PhotoSpot) => string | undefined;
		checklistDone: (bi: number, ii: number, item: ChecklistItem) => boolean;
		onToggleChecklist: (bi: number, item: ChecklistItem, ii: number) => void;
		onopenlightbox: (list: TripPhoto[], index: number) => void;
		onphotostopclick: (blockIndex: number) => void;
		/** In-place editing: text fields become contenteditable in situ. */
		edit?: boolean;
		/** Fired after any edit, so the page can save and record an undo step.
		 *  `structural` forces its own step (see lib/trip/history.svelte.ts). */
		onedit?: (structural?: boolean) => void;
		/** Step the document history back — offered as the action on the toast a
		 *  deletion raises, so removing a stop is never a dead end. */
		onundo?: () => void;
		/** Photos on this day still placed by DATE rather than by the day's stable
		 *  id — the only ones a date change would now orphan. Rows carrying a
		 *  day_id follow the day (migration 0013), so this is zero once the
		 *  backfill has run and the warning stops appearing on its own. */
		dayPhotoCount?: number;
		/** Day-level structural ops. Owned by TripView, which also has to move the
		 *  day selection when the current day is removed or reordered. */
		ondayinsert?: () => void;
		ondayduplicate?: () => void;
		ondayremove?: () => void;
		ondaymove?: (dir: -1 | 1) => void;
		canDayMoveUp?: boolean;
		canDayMoveDown?: boolean;
		canDayRemove?: boolean;
	} = $props();

	const L = (obj: Parameters<typeof loc>[1]) => loc(trip, obj, lang);
	const money = (n: number) => formatMoney(n, trip.currency, localeFor(trip, lang));
	/* Trip-chrome strings follow the TRIP CONTENT language, not the UI locale. */
	const uiText = $derived(tripChrome[lang === 'pt' ? 'pt' : 'en']);
	const offline = $derived(!isOnline());
	// `trip` is fixed for the lifetime of a mounted view (the page remounts per
	// trip id), so this initial read is intentionally non-reactive — same as the
	// untracked read TripView does.
	const isPast = untrack(() => tripIsPast(trip));

	const km = $derived(dayKmTotal(day));
	const dayCost = $derived(dayCostTotal(day));

	// ── Structural editing (Phase 4) ──
	// Every op mutates `day.blocks` in place and then reports a STRUCTURAL edit,
	// so it lands as its own undo step instead of merging into an adjacent
	// typing burst.
	function structural() {
		onedit?.(true);
	}
	function insertAt(i: number) {
		const b = blankBlock(trip.languages);
		// Seed the time from the stop above, so a new stop lands in sequence
		// rather than jumping to the top of the day's ordering.
		const prev = day.blocks[i - 1];
		if (prev?.time) b.time = prev.time;
		day.blocks.splice(i, 0, b);
		syncBlocks();
		structural();
	}
	function duplicateAt(i: number) {
		const copy = structuredClone($state.snapshot(day.blocks[i])) as Block;
		day.blocks.splice(i + 1, 0, copy);
		syncBlocks();
		structural();
	}
	function removeAt(i: number) {
		day.blocks.splice(i, 1);
		syncBlocks();
		structural();
		// Undo is the confirmation. Asking first would be friction on an action
		// that is one keystroke (or one tap) away from being reversed.
		toast.danger(t('block.removed'), {
			actionLabel: t('common.undo'),
			onAction: () => {
				onundo?.();
				dismissToast();
			}
		});
	}
	function moveAt(i: number, dir: -1 | 1) {
		moveInArray(day.blocks, i, dir);
		syncBlocks();
		structural();
	}

	// ── Drag reorder ──
	// svelte-dnd-action owns the list identity during a drag (it injects a shadow
	// item), so the wrapped list lives in state and is only mirrored back into
	// the model on finalize. Mirrors the form editor's DayEditor exactly.
	type BlockItem = { id: string; item: Block };
	let blockDragDisabled = $state(true);
	const wrap = (b: Block): BlockItem => ({ id: dndId(b), item: b });
	let blockItems = $state<BlockItem[]>(untrack(() => day.blocks.map(wrap)));
	function syncBlocks() {
		blockItems = day.blocks.map(wrap);
	}
	$effect(() => {
		const modelIds = day.blocks.map(dndId).join('|');
		untrack(() => {
			if (blockItems.map((w) => w.id).join('|') !== modelIds) blockItems = day.blocks.map(wrap);
		});
	});
	function considerBlocks(e: CustomEvent<{ items: BlockItem[] }>) {
		blockItems = e.detail.items;
	}
	function finalizeBlocks(e: CustomEvent<{ items: BlockItem[] }>) {
		blockItems = e.detail.items;
		day.blocks = fromItems(e.detail.items);
		blockDragDisabled = true;
		structural();
	}
	function grabBlock() {
		grabHandle((v) => (blockDragDisabled = v));
	}
	const mapAriaLabel = $derived(
		lang === 'pt' ? `Mapa do dia, ${mapStops.length} paradas` : `Day map, ${mapStops.length} stops`
	);
</script>

<!-- The day-switch entry is CSS, not a Svelte transition, and it animates the
     PARTS rather than the pane. Three reasons it moved: the pieces can then
     arrive on a stagger and travel different distances (the timeline nearest,
     the map furthest back), which is what stops it reading as one rigid slab;
     `{#key}` remounts this subtree so CSS animations replay for free; and it
     leaves the drag-and-drop FLIP in edit mode completely alone. Dropping the
     transform off the grid container also fixes a latent glitch — a transformed
     ancestor becomes the containing block for `position: sticky`, so the desktop
     map used to lose its pin for the length of the animation.
     `--dir` carries the direction travelled into every keyframe below. -->
<div class="day-content" style="--dir:{dir}">
	<div class="day-hdr">
		<div class="dh-in">
			<div class="dh-eye">
				{dayLabel(day.date, localeFor(trip, lang))}
				{#if edit}
					<DayInspector
						{day}
						{plan}
						photoCount={dayPhotoCount}
						{onedit}
						oninsert={ondayinsert}
						onduplicate={ondayduplicate}
						onremove={ondayremove}
						onmove={ondaymove}
						canMoveUp={canDayMoveUp}
						canMoveDown={canDayMoveDown}
						canRemove={canDayRemove}
					/>
				{/if}
			</div>
			<div class="dh-title">
				<EditableText bind:value={day.title} {lang} {edit} {onedit} label={uiText.edDayTitle} />
			</div>
			{#if edit || L(day.note)}
				<div class="dh-note">
					<EditableText bind:value={day.note} {lang} {edit} {onedit} label={uiText.edDayNote} />
				</div>
			{/if}
			{#if wx || km || dayCost}
				{@const dayWalkMin = km ? walkMinutes(km) : null}
				<div class="wx-hdr">
					{#if wx}
						<div class="wx-hdr-item" aria-hidden="true">{wx.emoji}</div>
						<div class="wx-hdr-item">↑{formatTemp(wx.hi)}</div>
						<div class="wx-hdr-item">↓{formatTemp(wx.lo)}</div>
						{#if offline}
							<Tip text={uiText.wxOfflineHint}>
								<div class="wx-hdr-item wx-hdr-offline">
									{uiText.wxOffline}
								</div>
							</Tip>
						{/if}
					{/if}
					{#if km}
						<div class="wx-hdr-item wx-km">
							🦶 ~{km.toFixed(1)} km{#if dayWalkMin} · ~{dayWalkMin} {uiText.walkSuffix}{/if}
						</div>
					{/if}
					{#if dayCost}
						<div class="wx-hdr-item wx-cost">💷 {money(dayCost)}</div>
					{/if}
				</div>
			{/if}
			{#if L(day.banner)}
				<div class="bday-strip">
					<EditableText bind:value={day.banner} {lang} {edit} {onedit} label={uiText.edBanner} />
				</div>
			{/if}
		</div>
	</div>

	<aside class="day-aside">
		{#if mapStops.length >= 2}
			<DayMap
				stops={mapStops}
				ariaLabel={mapAriaLabel}
				photoStops={photoMapStops}
				onphotostopclick={onphotostopclick}
			/>
		{/if}

		{#if routeForDay}
			<!-- Mobile-only compact stand-in for the (hidden) route stepper:
			     preserves the one thing the card uniquely offers, the Maps link. -->
			<a href={routeForDay.url} target="_blank" rel="noopener noreferrer" class="maps-link-btn">
				<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" /><circle cx="12" cy="9" r="2.5" /></svg>
				{uiText.openRoute}
			</a>

			<!-- Full Day-Route stepper: desktop only (hidden on mobile). -->
			<a href={routeForDay.url} target="_blank" rel="noopener noreferrer" class="route-card">
				<div class="route-hdr">
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" /></svg>
					{uiText.dayRoute}
				</div>
				<div class="route-stops">
					{#each routeForDay.places as p, i (i)}
						{#if i > 0}<div class="route-connector"></div>{/if}
						<div class="route-stop">
							<div class="route-num">{p.n}</div>
							<div class="route-name">{p.name}</div>
						</div>
					{/each}
				</div>
				<div class="route-open">
					<svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" /><circle cx="12" cy="9" r="2.5" /></svg>
					{uiText.openRoute}
				</div>
			</a>
		{/if}
	</aside>

	<div class="tl">
		{#if edit}
			<!-- Editing: the timeline is a drag zone, so its children must map 1:1
			     onto the dnd items — which is why the "now" marker (read-only
			     chrome, and meaningless while restructuring a day) is omitted here
			     and the insert affordances live inside each block. -->
			<div
				class="tl-dnd"
				use:dndzone={{ items: blockItems, flipDurationMs: FLIP_MS, dragDisabled: blockDragDisabled, dropTargetStyle: {} }}
				onconsider={considerBlocks}
				onfinalize={finalizeBlocks}
			>
				{#each blockItems as w, bi (w.id)}
					<TripBlock
						{trip}
						{lang}
						{plan}
						block={w.item}
						index={bi}
						stopNum={stopNums[bi] ?? null}
						isLast={bi === blockItems.length - 1}
						badge={badgeFor(w.item.time)}
						{isPast}
						photos={photosByBlock.get(bi) ?? []}
						{photoToken}
						{spotImg}
						checklistDone={(ii, item) => checklistDone(bi, ii, item)}
						onToggleChecklist={(item, ii) => onToggleChecklist(bi, item, ii)}
						onopenphoto={(pi) => onopenlightbox(photosByBlock.get(bi) ?? [], pi)}
						{edit}
						{onedit}
						oninsertbefore={() => insertAt(bi)}
						onduplicate={() => duplicateAt(bi)}
						onremove={() => removeAt(bi)}
						onmove={(dir) => moveAt(bi, dir)}
						ongrab={grabBlock}
						canMoveUp={bi > 0}
						canMoveDown={bi < blockItems.length - 1}
						showDiff={seg.plans.length > 1}
					/>
				{/each}
			</div>
			<button type="button" class="add-stop" onclick={() => insertAt(day.blocks.length)}>
				<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 5v14M5 12h14" /></svg>
				{t('block.addStop')}
			</button>
		{:else}
			{#each day.blocks as b, bi (bi)}
				{#if isToday && nowMarkerIdx === bi}
					<NowMarker label="{uiText.now} · {nowLabel}" bind:el={nowMarkerEl} />
				{/if}
				<TripBlock
					{trip}
					{lang}
					{plan}
					block={b}
					index={bi}
					stopNum={stopNums[bi] ?? null}
					isLast={bi === day.blocks.length - 1}
					isNext={isToday && nowMarkerIdx === bi}
					badge={badgeFor(b.time)}
					{isPast}
					photos={photosByBlock.get(bi) ?? []}
					{photoToken}
					{spotImg}
					checklistDone={(ii, item) => checklistDone(bi, ii, item)}
					onToggleChecklist={(item, ii) => onToggleChecklist(bi, item, ii)}
					onopenphoto={(pi) => onopenlightbox(photosByBlock.get(bi) ?? [], pi)}
				/>
			{/each}
			{#if isToday && day.blocks.length > 0 && nowMarkerIdx === day.blocks.length}
				<NowMarker label="{uiText.now} · {nowLabel}" end bind:el={nowMarkerEl} />
			{/if}
		{/if}
	</div>

	{#if dayLevelPhotos.length}
		<div class="day-photos">
			<div class="dp-title">{uiText.photos}</div>
			<PhotoStrip
				photos={dayLevelPhotos}
				tripId={trip.id}
				{photoToken}
				openLabel={uiText.openPhoto}
				onopen={(pi) => onopenlightbox(dayLevelPhotos, pi)}
			/>
		</div>
	{/if}
	{#if L(seg.footer)}
		<div class="footer">
			<EditableText bind:value={seg.footer} {lang} {edit} {onedit} label={uiText.edFooter} />
		</div>
	{/if}
</div>

<style>
	/* ── Day-switch entry ──
	   The day's parts assemble rather than sliding in as one block. Each part
	   travels a different distance on the same directional axis — the timeline
	   cards furthest (nearest the eye), the day header less, the map/route column
	   least (furthest back) — which is what gives the switch depth instead of the
	   flat slab feel of a single pane transform. On top of that the timeline
	   cards arrive on a short stagger, so the day lays itself out in sequence.

	   `--dir` (+1 forward through the trip, -1 back) is set inline on
	   `.day-content`, so every part leans in from the side you came from.

	   The easing lands with a hair of overshoot (the 1.02 on the last control
	   point) — enough to read as settling into place rather than stopping dead,
	   not enough to bounce.

	   The whole block is gated behind `prefers-reduced-motion: no-preference`:
	   with reduced motion no animation is declared at all, so the day simply
	   appears — no delayed `both` fill to leave anything invisible. */
	@media (prefers-reduced-motion: no-preference) {
		@keyframes day-part-in {
			from {
				opacity: 0;
				transform: translate3d(calc(var(--dir, 1) * var(--shift, 16px)), var(--rise, 6px), 0);
			}
			to {
				opacity: 1;
				transform: none;
			}
		}
		.day-hdr,
		.day-aside,
		.day-photos,
		.footer,
		/* Read mode: the timeline's direct children ARE the stop cards (plus the
		   "now" marker). While editing they are a single dnd zone + the add button,
		   so the per-card stagger below simply doesn't apply and the drag FLIP is
		   left untouched. */
		.tl > :global(*) {
			animation: day-part-in 300ms cubic-bezier(0.2, 0.9, 0.25, 1.02) both;
		}
		.day-hdr {
			--shift: 14px;
			--rise: 5px;
			animation-delay: 0ms;
		}
		.day-aside {
			/* Furthest back: moves least, arrives slowest. */
			--shift: 7px;
			--rise: 3px;
			animation-duration: 360ms;
			animation-delay: 30ms;
		}
		.tl > :global(*) {
			--shift: 20px;
			--rise: 8px;
		}
		/* Stagger, capped at the 7th card: beyond that everything is below the fold
		   on a phone, and a longer tail would just make a 12-stop day feel slow. */
		.tl > :global(*:nth-child(1)) {
			animation-delay: 55ms;
		}
		.tl > :global(*:nth-child(2)) {
			animation-delay: 85ms;
		}
		.tl > :global(*:nth-child(3)) {
			animation-delay: 112ms;
		}
		.tl > :global(*:nth-child(4)) {
			animation-delay: 136ms;
		}
		.tl > :global(*:nth-child(5)) {
			animation-delay: 157ms;
		}
		.tl > :global(*:nth-child(6)) {
			animation-delay: 174ms;
		}
		.tl > :global(*:nth-child(n + 7)) {
			animation-delay: 188ms;
		}
		.day-photos,
		.footer {
			--shift: 12px;
			--rise: 5px;
			animation-delay: 200ms;
		}
	}

	.day-hdr {
		margin: 10px 13px 0;
		background: var(--hero-bg);
		border-radius: var(--radius-lg);
		/* Slimmed: tighter padding + smaller title + a single compact weather row
		   trims the header from ~107px toward ~80px, so more of the timeline is
		   visible on first paint. Keeps the theme colour band identity. */
		padding: 8px 14px 8px;
	}
	.dh-eye {
		font-size: 9px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--hero-eyebrow);
		opacity: 0.7;
		margin-bottom: 1px;
		/* Editing adds the day's ⋮ beside the date; the row has to become a flex
		   line for it, and loses the opacity so the control isn't washed out. */
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		min-height: 12px;
	}
	.dh-title {
		font-family: 'Source Serif 4', serif;
		font-size: 16px;
		color: #fff;
		font-weight: 700;
		line-height: 1.15;
	}
	.dh-note {
		font-size: 11px;
		color: rgba(255, 255, 255, 0.55);
		margin-top: 3px;
		line-height: 1.4;
	}
	.bday-strip {
		background: var(--heather);
		border-radius: var(--radius-md);
		padding: 6px 11px;
		margin-top: 8px;
		font-family: 'Source Serif 4', serif;
		font-style: italic;
		font-size: 12px;
		color: #fff;
		line-height: 1.3;
	}
	.wx-hdr {
		display: flex;
		gap: 8px;
		flex-wrap: nowrap;
		padding: 0;
		font-size: 10.5px;
		color: rgba(255, 255, 255, 0.85);
		margin-top: 4px;
	}
	.wx-hdr-item {
		display: flex;
		align-items: center;
		gap: 3px;
	}
	.wx-km {
		color: #cfe0b8;
		font-weight: 600;
		padding-left: 8px;
		border-left: 1px solid rgba(255, 255, 255, 0.25);
	}
	.wx-cost {
		color: #f0d692;
		font-weight: 600;
		padding-left: 8px;
		border-left: 1px solid rgba(255, 255, 255, 0.25);
		font-variant-numeric: tabular-nums;
	}
	/* Offline-stale-weather hint (Phase 6 item 5): same muted white already
	   used for .dh-note in this hero-photo context, not a new token. */
	.wx-hdr-offline {
		color: rgba(255, 255, 255, 0.55);
	}
	.tl {
		padding: 2px 13px 0;
	}
	/* Full-width quiet button closing the timeline while editing — the one place
	   a stop can be appended rather than inserted above an existing one. */
	.add-stop {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 100%;
		min-height: 40px;
		margin-top: 6px;
		box-sizing: border-box;
		border: 1px dashed var(--hairline-strong);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--text-muted);
		font-family: var(--font-ui);
		font-size: 12px;
		cursor: pointer;
	}
	@media (hover: hover) {
		.add-stop:hover {
			border-color: var(--accent-text);
			color: var(--accent-text);
			background: color-mix(in srgb, var(--accent-text) 6%, transparent);
		}
	}
	.footer {
		text-align: center;
		padding: 10px 0 3px;
		font-size: 10px;
		color: var(--text-muted);
		opacity: 0.7;
		font-family: 'Source Serif 4', serif;
		font-style: italic;
		letter-spacing: 0.05em;
	}
	/* Single-column (<700px): the Day-Route stepper is hidden (its Maps link
	   survives as the compact .maps-link-btn under the map). It returns in the
	   two-pane block below, where it sits in the sticky right column under the map. */
	.route-card {
		display: none;
		margin: 10px 13px 4px;
		background: var(--surface-sunken);
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-lg);
		padding: 12px 14px 10px;
		text-decoration: none;
		color: var(--text);
	}
	/* Compact full-width quiet button that replaces the stepper in the
	   single-column layout — the route card's one unique affordance (open the
	   whole day's route in Maps), kept at ≥44px tall. Hidden at ≥700px, where the
	   full card is back. */
	.maps-link-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		margin: 4px 13px 2px;
		min-height: 44px;
		box-sizing: border-box;
		padding: 6px 12px;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-button);
		background: var(--surface-sunken);
		color: var(--accent-text);
		font-family: 'Source Serif 4', serif;
		font-size: 12px;
		text-decoration: none;
	}
	@media (hover: hover) {
		.maps-link-btn:hover {
			border-color: var(--accent-text);
			background: color-mix(in srgb, var(--accent-text) 6%, transparent);
		}
	}
	@media (prefers-reduced-motion: no-preference) {
		.maps-link-btn {
			transition:
				border-color 0.15s ease,
				background 0.15s ease,
				transform 0.1s ease;
		}
		.maps-link-btn:active {
			transform: scale(0.98);
		}
	}
	@media (hover: hover) {
		.route-card:hover {
			border-color: var(--accent-text);
			box-shadow: var(--elevation-1);
		}
	}
	@media (prefers-reduced-motion: no-preference) {
		.route-card {
			transition:
				border-color 0.15s ease,
				box-shadow 0.15s ease,
				transform 0.1s ease;
		}
		.route-card:active {
			transform: scale(0.98);
		}
	}
	.route-hdr {
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: 'Source Serif 4', serif;
		font-size: 13px;
		font-weight: 600;
		color: var(--accent-text);
		margin-bottom: 8px;
	}
	.route-stops {
		display: flex;
		align-items: flex-start;
		overflow-x: auto;
		scrollbar-width: none;
		padding: 2px 0 6px;
	}
	.route-stops::-webkit-scrollbar {
		display: none;
	}
	.route-stop {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex-shrink: 0;
	}
	.route-num {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		/* Same fill as the timeline's numbered dot (see TripBlock .tb-stop-num):
		   both sit on the page surface, where solid --accent is a dark green on
		   dark navy and barely reads. */
		background: var(--accent-text);
		color: var(--surface);
		font-size: 11px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.route-name {
		font-size: 9px;
		color: var(--text-muted);
		text-align: center;
		width: 70px;
		line-height: 1.25;
		margin-top: 3px;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.route-connector {
		width: 20px;
		height: 2px;
		background: repeating-linear-gradient(90deg, var(--hairline-strong) 0, var(--hairline-strong) 4px, transparent 4px, transparent 7px);
		margin: 0 1px;
		flex-shrink: 0;
		align-self: flex-start;
		margin-top: 10px;
	}
	.route-open {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		font-size: 11px;
		color: var(--accent-text);
		padding-top: 4px;
		border-top: 1px solid var(--hairline);
		margin-top: 2px;
	}
	.day-photos {
		margin: 10px 13px 4px;
		padding: 10px 12px;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-lg);
	}
	.dp-title {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}

	/* ── Two-pane day body (≥700px) ──
	   The day body becomes a two-column grid: a scrolling left column (header,
	   timeline, photos) and a sticky right column holding the map then the
	   Day-Route card. The keyed day-switch fly transition applies to the whole
	   .day-content grid. The shell/hero/daynav half of this breakpoint stays in
	   TripView, which owns those elements.

	   This starts at 700px, not 960px: TripView's shell now grows past its old
	   430px cap from 700px up, and a single 900px-wide column would just be
	   over-long lines of text. The 960px block below re-tunes the same grid for
	   desktop (wider gutters, wider map floor, no sticky day nav to clear). */
	@media (min-width: 700px) {
		.day-content {
			display: grid;
			/* Left track (timeline) capped at a readable line length; the map track
			   is `1fr`, so all extra viewport width flows to the map. The map floor
			   steps up with the tier: 260px here (no sidebar, but a narrow shell),
			   320px on the tight 960–1199 tier (240px sidebar present) and 420px at
			   ≥1200 (both below). */
			grid-template-columns: minmax(0, 760px) minmax(260px, 1fr);
			gap: 0 20px;
			padding: 0 16px 8px;
			align-items: start;
		}
		/* Left-column items are pinned to explicit rows 1-4 and the aside spans
		   those same rows (grid-row: 1 / 5). Spanning explicit row lines — rather
		   than `1 / -1`, which collapses to a single row when no rows are declared
		   and would force row 1 to the map's full height — lets the tall map/route
		   column sit beside the naturally-flowing left column. */
		.day-hdr,
		.tl,
		.day-photos,
		.footer {
			grid-column: 1;
			min-width: 0;
		}
		.day-hdr {
			grid-row: 1;
			margin: 16px 0 0;
		}
		.tl {
			grid-row: 2;
			padding: 12px 0 0;
		}
		.day-photos {
			grid-row: 3;
			margin: 12px 0 0;
		}
		.footer {
			grid-row: 4;
		}
		.day-aside {
			grid-column: 2;
			grid-row: 1 / 5;
			align-self: start;
			position: sticky;
			/* On this tier TripView's horizontal day nav is still present and sticky
			   at top: 0 — ~44px, or ~64px once its stuck context line appears. Clear
			   both so the map never slides under it. */
			top: 76px;
		}
		.route-card {
			display: block;
			margin: 16px 0 0;
		}
		.maps-link-btn {
			display: none;
		}
	}

	/* ── Desktop (≥960px) ──
	   Same two-pane grid, re-tuned: full-bleed shell, 24px gutters matching the
	   hero, and a wider map floor now that the 240px sidebar has taken over
	   day navigation. */
	@media (min-width: 960px) {
		.day-content {
			grid-template-columns: minmax(0, 760px) minmax(320px, 1fr);
			gap: 0 24px;
			padding: 0 24px 8px;
		}
		.day-aside {
			/* No sticky day nav to clear at ≥960px anymore; this offset keeps the map
			   clear of the demo page's sticky "sample trip" banner. */
			top: 72px;
		}
	}

	/* ── Wide desktop (≥1200px) ──
	   The 240px sidebar leaves room for the full-width map again, so the day body's
	   right column returns to a fixed 420px (it was narrowed on the 960–1199 tier). */
	@media (min-width: 1200px) {
		.day-content {
			grid-template-columns: minmax(0, 760px) minmax(420px, 1fr);
		}
	}
</style>
