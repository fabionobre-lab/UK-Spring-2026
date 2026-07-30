<script lang="ts">
	// One localized string, edited in place inside the rendered itinerary.
	//
	// When `edit` is false this renders a bare text node — byte-identical DOM to
	// the plain `{L(obj)}` it replaces, so read mode is untouched. When `edit` is
	// true it becomes a contenteditable span that inherits the surrounding
	// element's typography, so the text keeps looking exactly like the output
	// it is. All chrome (hover tint, placeholder) lives here; the call site keeps
	// its own wrapper element and CSS, which is also what keeps Svelte's style
	// scoping working.
	//
	// Edits target the CURRENTLY VIEWED language (`lang`, the hero's EN|PT
	// toggle), which is what makes multi-language authoring bearable compared to
	// the form editor's stacked per-language inputs.
	import type { Localized } from '$lib/trip-engine';

	let {
		value = $bindable(),
		lang,
		edit = false,
		label,
		onedit
	}: {
		/** The localized object being edited; may be absent for optional fields
		 *  (block.note, day.banner…) and is created on first keystroke. */
		value: Localized | undefined;
		lang: string;
		edit?: boolean;
		/** Accessible name, also shown as the placeholder while empty. */
		label: string;
		/** Fired after the model changed, so the page can schedule an autosave. */
		onedit?: () => void;
	} = $props();

	let el = $state<HTMLElement | null>(null);
	let focused = $state(false);

	const text = $derived(value?.[lang] ?? '');

	// Model → DOM, but never while this field has focus: rewriting textContent
	// under the caret collapses the selection to offset 0, and this effect
	// re-runs on every keystroke (the model changed), on autosave, and when a
	// sibling field edits. Blur re-syncs, so an external change still lands.
	$effect(() => {
		const next = text;
		if (el && !focused && el.textContent !== next) el.textContent = next;
	});

	function commit() {
		if (!el) return;
		const next = el.textContent ?? '';
		if ((value?.[lang] ?? '') === next) return;
		// Absent optional field: create the whole object in one assignment so the
		// write goes through $bindable to the parent's state proxy (mutating a
		// freshly-assigned plain object would not be tracked).
		if (!value) value = { [lang]: next };
		else value[lang] = next;
		onedit?.();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			el?.blur();
			return;
		}
		// Every inline field is single-line: the read view renders with normal
		// white-space, so an embedded newline would be invisible anyway. Long-form
		// editing belongs in the per-block inspector.
		if (e.key === 'Enter') {
			e.preventDefault();
			el?.blur();
		}
	}

	// `plaintext-only` already strips formatting on paste in current browsers;
	// this also flattens newlines, for the single-line reason above.
	function onpaste(e: ClipboardEvent) {
		const pasted = e.clipboardData?.getData('text/plain');
		if (pasted == null) return;
		e.preventDefault();
		document.execCommand('insertText', false, pasted.replace(/\s*\n+\s*/g, ' '));
	}
</script>

{#if edit}
	<span
		bind:this={el}
		class="ed"
		class:blank={!text}
		contenteditable="plaintext-only"
		role="textbox"
		tabindex="0"
		aria-label={label}
		data-placeholder={label}
		oninput={commit}
		onfocus={() => (focused = true)}
		onblur={() => {
			focused = false;
			commit();
		}}
		{onkeydown}
		{onpaste}
	></span>
{:else}{text}{/if}

<style>
	/* Inline, so an editable field adds no box of its own and cannot shift the
	   layout of the element it sits in. Colour and type are inherited from the
	   call site (.tb-title, .dh-title, .tb-meta…) — that inheritance is the whole
	   point: the field IS the rendered text. */
	.ed {
		cursor: text;
		border-radius: 3px;
		caret-color: var(--accent-text);
		/* Wrap long words rather than overflow the timeline column while typing. */
		overflow-wrap: anywhere;
	}
	/* Quiet until pointed at — the "no chrome until hover" rule. */
	@media (hover: hover) {
		.ed:hover {
			background: color-mix(in srgb, var(--accent-text) 8%, transparent);
			box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--accent-text) 45%, transparent);
		}
	}
	/* The 2px gold ring comes from the global :focus-visible rule in
	   styles/tokens.css — editable elements match it on click too, so this only
	   needs to keep the ring off the glyphs. */
	.ed:focus-visible {
		outline-offset: 2px;
	}
	.ed.blank::after {
		content: attr(data-placeholder);
		color: var(--text-muted);
		opacity: 0.75;
		font-style: italic;
		font-weight: 400;
	}
	@media (prefers-reduced-motion: no-preference) {
		.ed {
			transition:
				background 0.12s ease,
				box-shadow 0.12s ease;
		}
	}
</style>
