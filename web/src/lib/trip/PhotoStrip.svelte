<script lang="ts">
	// Thumbnail strip of linked Google Photos. Extracted from TripView, where the
	// three call sites — inside a timeline block, at day level, and the trip's
	// unmatched photos — rendered byte-identical markup and duplicated the CSS.
	import { photoUrl, type TripPhoto } from '$lib/photos';

	let {
		photos,
		tripId,
		photoToken,
		openLabel,
		onopen
	}: {
		photos: TripPhoto[];
		tripId: string;
		/** Public-link token (the /s/[token] route), threaded into every photoUrl(). */
		photoToken?: string;
		/** aria-label for each thumbnail button ("Open photo"), in the trip language. */
		openLabel: string;
		onopen: (index: number) => void;
	} = $props();
</script>

<div class="ph-strip">
	{#each photos as p, pi (p.id)}
		<button class="ph-thumb" onclick={() => onopen(pi)} aria-label={openLabel}>
			<img src={photoUrl(tripId, p.id, 'thumb', photoToken)} alt="" loading="lazy" />
		</button>
	{/each}
</div>

<style>
	.ph-strip {
		margin-top: 8px;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.ph-thumb {
		width: 56px;
		height: 56px;
		padding: 0;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-md);
		background: var(--surface-sunken);
		overflow: hidden;
		cursor: pointer;
	}
	.ph-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		filter: var(--photo-filter);
	}
</style>
