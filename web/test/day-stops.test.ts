// One numbering per day, shared by the day map, the Day-Route stepper and the
// timeline dot. Before dayStops existed the map counted coord-bearing blocks
// and the stepper counted mapsUrl-bearing ones, so the same place carried two
// different numbers whenever a day mixed the two — which is exactly what these
// tests pin down.
import { describe, expect, it } from 'vitest';
import { dayStops, blockStopNumbers, routePlaces } from '../src/lib/trip-engine';
import type { Block, Trip } from '../src/lib/trip-engine';

const trip = { languages: ['pt'], defaultLang: 'pt' } as unknown as Trip;

const block = (title: string, extra: Partial<Block> = {}): Block =>
	({ time: '09:00', title: { pt: title }, ...extra }) as Block;

const withMaps = (title: string) => block(title, { mapsUrl: `https://maps.google.com/?q=${title}` });
const withCoords = (title: string) => block(title, { coords: { lat: 41.9, lon: 12.5 } });
const withBoth = (title: string) =>
	block(title, { mapsUrl: `https://maps.google.com/?q=${title}`, coords: { lat: 41.9, lon: 12.5 } });

describe('dayStops', () => {
	it('numbers coord-only and maps-only blocks in one sequence', () => {
		const blocks = [withBoth('a'), withMaps('b'), withCoords('c'), withBoth('d')];
		expect(dayStops(trip, blocks, 'pt').map((s) => [s.n, s.name])).toEqual([
			[1, 'a'],
			[2, 'b'],
			[3, 'c'],
			[4, 'd']
		]);
	});

	it('gives the map pin and the route stop the same number for one place', () => {
		// 'b' has no coordinates, so it is absent from the map but must not shift
		// the numbers of the pins after it.
		const blocks = [withBoth('a'), withMaps('b'), withBoth('c')];
		const stops = dayStops(trip, blocks, 'pt');
		expect(stops.filter((s) => s.coords).map((s) => s.n)).toEqual([1, 3]);
		expect(routePlaces(trip, blocks, 'pt').map((p) => p.n)).toEqual([1, 2, 3]);
	});

	it('skips a block no surface can locate', () => {
		const blocks = [withBoth('a'), block('dinner'), withBoth('c')];
		expect(dayStops(trip, blocks, 'pt').map((s) => s.n)).toEqual([1, 2]);
		expect(blockStopNumbers(dayStops(trip, blocks, 'pt'), blocks.length)).toEqual([1, null, 2]);
	});

	it('numbers a filled-in waypoint after its block and ignores blank ones', () => {
		const blocks = [
			block('a', {
				mapsUrl: 'https://maps.google.com/?q=a',
				waypoints: [{ query: 'w1', name: { pt: 'w1' } }, { name: { pt: 'blank' } }]
			} as Partial<Block>),
			withBoth('b')
		];
		const stops = dayStops(trip, blocks, 'pt');
		expect(stops.map((s) => [s.n, s.name])).toEqual([
			[1, 'a'],
			[2, 'w1'],
			[3, 'b']
		]);
		// The waypoint owns number 2 but is not the block's own stop, so the
		// timeline still labels block 'b' with 3.
		expect(blockStopNumbers(stops, blocks.length)).toEqual([1, 3]);
	});
});
