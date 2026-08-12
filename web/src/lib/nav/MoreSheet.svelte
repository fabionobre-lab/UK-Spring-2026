<script lang="ts">
	// Bottom sheet that slides up from the bar. Kept in the DOM at all times
	// (visibility toggles) so SSR and the client agree; focus is trapped while
	// open, Escape and a scrim tap both close it, and body scroll is locked so
	// the page behind doesn't move. Motion respects prefers-reduced-motion via a
	// CSS media query (the transform/opacity transitions simply drop out).
	import type { Snippet } from 'svelte';
	import NavIcon from './NavIcon.svelte';

	let {
		open = $bindable(false),
		label,
		closeLabel,
		bottomOffset = 0,
		children
	}: {
		open?: boolean;
		label: string;
		closeLabel: string;
		/** Measured height of the bottom bar in px, so the sheet can sit ON TOP of
		 *  it rather than over it. Measured rather than taken from the --bb-h
		 *  token because the token is only the bar's MIN height: the rendered bar
		 *  is taller once its icon+label content and the safe-area inset are in
		 *  (69px vs 56px on a stock phone). It also falls to 0 by itself wherever
		 *  the bar is display:none — hidden routes and every width >=960px — which
		 *  is exactly the offset those cases want. */
		bottomOffset?: number;
		children: Snippet;
	} = $props();

	let panelEl = $state<HTMLDivElement | null>(null);
	let restoreFocus: HTMLElement | null = null;

	function close() {
		open = false;
	}

	function focusables(): HTMLElement[] {
		if (!panelEl) return [];
		return Array.from(
			panelEl.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		).filter((el) => el.offsetParent !== null);
	}

	// Escape is handled at the window, not on the panel. The panel-scoped handler
	// was enough while the open sheet covered the bar and focus could not leave
	// it; now that the bar is reachable, focus can sit outside the panel (on the
	// More button that opened it) and a panel-scoped Escape would silently do
	// nothing there.
	function onWindowKeydown(e: KeyboardEvent) {
		if (!open || e.key !== 'Escape') return;
		e.preventDefault();
		close();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const items = focusables();
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement as HTMLElement | null;
		if (e.shiftKey && active === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}

	// Drive focus + scroll-lock off the open flag. On open, remember the trigger
	// so focus returns to it on close (the More button in the bar).
	$effect(() => {
		if (open) {
			restoreFocus = document.activeElement as HTMLElement | null;
			document.body.style.overflow = 'hidden';
			// Wait a frame so the panel is visible/tabbable before focusing.
			requestAnimationFrame(() => focusables()[0]?.focus());
		} else {
			document.body.style.overflow = '';
			restoreFocus?.focus?.();
			restoreFocus = null;
		}
		return () => {
			document.body.style.overflow = '';
		};
	});
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="sheet-root" class:open aria-hidden={!open} style="--bb-offset:{bottomOffset}px">
	<button type="button" class="scrim" tabindex="-1" aria-label={closeLabel} onclick={close}></button>
	<div
		bind:this={panelEl}
		class="panel"
		role="dialog"
		aria-modal="true"
		aria-label={label}
		tabindex="-1"
		onkeydown={onKeydown}
	>
		<div class="handle">
			<span class="grabber" aria-hidden="true"></span>
			<button type="button" class="close" aria-label={closeLabel} onclick={close}>
				<NavIcon name="close" size={20} />
			</button>
		</div>
		<div class="rows">
			{@render children()}
		</div>
	</div>
</div>

<style>
	.sheet-root {
		position: fixed;
		inset: 0;
		z-index: 1100;
		visibility: hidden;
		pointer-events: none;
	}
	.sheet-root.open {
		visibility: visible;
	}
	/* The root spans the viewport for layout only — it must never take the tap
	   itself, or the strip of bar left uncovered below the scrim would still be
	   dead (the root's own box sits over it). The scrim and panel opt back in. */
	.sheet-root.open .scrim,
	.sheet-root.open .panel {
		pointer-events: auto;
	}
	/* ── Clearing the bottom bar ──
	   The sheet is opened BY the bar's More button, so burying the bar under the
	   panel — and dimming whatever was left under the scrim — read as a glitch.
	   Both now stop at the top of the bar, so it stays fully lit and usable and
	   the sheet reads as a menu anchored to the bar rather than a modal thrown
	   over it. --bb-offset is the bar's MEASURED height (see the prop); the bar
	   owns the safe-area inset, so it is already included there and dropped from
	   the panel's own padding. */
	.scrim {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: var(--bb-offset, 0px);
		border: none;
		padding: 0;
		width: 100%;
		/* Family scrim token (was a local .5 literal — the .05 alpha delta to the
		   token's .55 is visually negligible and kills the drift). */
		background: var(--scrim);
		opacity: 0;
		cursor: default;
	}
	.sheet-root.open .scrim {
		opacity: 1;
	}
	.panel {
		position: absolute;
		left: 0;
		right: 0;
		bottom: var(--bb-offset, 0px);
		background: var(--surface);
		/* Kept as a local literal, not var(--radius-lg): 18px is this sheet's
		   signature top-corner curve, and snapping to the 12px lg token would be
		   a ~33% visible flattening of a prominent full-width edge. Phase 3 flag. */
		border-top-left-radius: 18px;
		border-top-right-radius: 18px;
		border-top: 1px solid var(--hairline);
		/* Upward bottom-sheet shadow — elevation tokens are downward-only, so this stays a local literal (Phase 3 flag). */
		box-shadow: 0 -8px 30px light-dark(rgba(26, 35, 50, 0.22), rgba(0, 0, 0, 0.3));
		/* The bar below owns the safe-area inset while it is there; where it is
		   not, --bb-offset is 0 and this adds the inset back itself. */
		padding: 0.4rem 0.9rem calc(0.9rem + max(0px, env(safe-area-inset-bottom) - var(--bb-offset, 0px)));
		/* Leave the bar's height out of the sheet's own budget, so a long menu
		   still stops short of the top of the screen rather than growing into the
		   space the bar occupies. */
		max-height: calc(85vh - var(--bb-offset, 0px));
		overflow-y: auto;
		transform: translateY(100%);
		font-family: var(--font-ui);
	}
	.sheet-root.open .panel {
		transform: translateY(0);
	}
	@media (prefers-reduced-motion: no-preference) {
		.scrim {
			transition: opacity var(--dur-base) var(--ease-out);
		}
		.panel {
			transition: transform var(--dur-slow) var(--ease-out);
		}
	}
	.handle {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 40px;
	}
	.grabber {
		width: 40px;
		height: 4px;
		border-radius: var(--radius-pill);
		background: var(--hairline-strong);
	}
	.close {
		position: absolute;
		right: 0;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		border-radius: var(--radius-button);
	}
	.close:hover {
		color: var(--accent-strong);
	}
	.rows {
		display: flex;
		flex-direction: column;
	}
</style>
