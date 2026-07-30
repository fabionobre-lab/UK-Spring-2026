<script lang="ts">
	// The "now" row on the timeline: a quiet accent rule with a small dot on the
	// rail and a tiny HH:MM label, sitting between the last started block and the
	// next upcoming one — or after the last block, when every block has started
	// (`end`). Rendered at two sites in TripDay, which is why it's its own file.
	let {
		label,
		end = false,
		el = $bindable(null)
	}: {
		/** Already-composed label, e.g. "Now · 14:32". */
		label: string;
		end?: boolean;
		/** The marker element, so the day can scroll it into view. */
		el?: HTMLDivElement | null;
	} = $props();
</script>

<div class="tb tb-now" class:tb-now-end={end} aria-hidden="true" bind:this={el}>
	<div class="tb-left"></div>
	<div class="tb-body tb-now-body">
		<div class="tb-now-dot"></div>
		<div class="tb-now-line"></div>
		<span class="tb-now-label">{label}</span>
	</div>
</div>

<style>
	.tb {
		display: flex;
	}
	.tb-left {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 50px;
		flex-shrink: 0;
		padding-top: 12px;
	}
	.tb-now .tb-left {
		width: 50px;
		flex-shrink: 0;
	}
	.tb-body {
		flex: 1;
		padding: 11px 0 11px 9px;
		border-bottom: 1px solid var(--hairline-strong);
	}
	.tb-now-body {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 0 0 5px;
		min-height: 16px;
		border-bottom: none;
	}
	.tb-now-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent-text);
		flex-shrink: 0;
		box-shadow: 0 0 0 2px var(--surface);
	}
	.tb-now-line {
		flex: 1;
		height: 1.5px;
		background: var(--accent-text);
		opacity: 0.55;
		margin: 0 6px;
	}
	.tb-now-label {
		font-size: 9px;
		letter-spacing: 0.03em;
		color: var(--accent-text);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}
</style>
