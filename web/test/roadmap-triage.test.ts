// P4 — feedback → roadmap triage against real D1 (Miniflare), no mocks, same
// discipline as the other server tests. Two things are under test here that
// the pure merge tests can't reach:
//
//   1. the write path and its validation — overlay rows land on the PUBLIC
//      page without a code review in between, so the bilingual invariant that
//      test/roadmap.test.ts asserts over roadmap.json has to hold at write
//      time too, and a rejected write must leave nothing behind;
//   2. the admin gate on /admin/roadmap — a signed-in non-admin must get a
//      404 from the load AND from every action (a form POST never re-runs
//      load, so the guard is repeated per action and must be tested per action).
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createFeedback, listFeedbackByStatus } from '../src/lib/server/feedback';
import { upsertGoogleUser, setUserStatus } from '../src/lib/server/users';
import { roadmap as baseRoadmap } from '../src/lib/roadmap/roadmap';
import { mergeRoadmap } from '../src/lib/roadmap/merge';
import {
	acceptFeedbackIntoRoadmap,
	deleteRoadmapItem,
	feedbackStatusFor,
	getRoadmapOverlayRow,
	listRoadmapOverlay,
	patchRoadmapItem,
	slugify,
	uniqueRoadmapId
} from '../src/lib/server/roadmap';
import { actions, load } from '../src/routes/admin/roadmap/+page.server';
import type { SessionUser } from '../src/lib/types';

const ADMIN_EMAIL = 'boss@example.com';

function platformWith(adminEmail = ADMIN_EMAIL) {
	return { env: { DB: env.DB, ADMIN_EMAIL: adminEmail } } as unknown as App.Platform;
}

let seq = 0;
/** Idempotent per email — the admin is fetched repeatedly across these tests,
 *  and a second sub for the same address would be a different user. */
async function approvedUser(email: string): Promise<SessionUser> {
	seq++;
	const user = await upsertGoogleUser(
		env.DB,
		{ sub: `triage-sub-${email}`, email, name: 'Tester' },
		undefined
	);
	await setUserStatus(env.DB, user.id, 'approved');
	return { ...user, status: 'approved' };
}

/** A 'new' feedback row to triage. */
async function newFeedback(message = 'Please add trip templates'): Promise<string> {
	const user = await approvedUser(`fb-${seq}@example.com`);
	const res = await createFeedback(env.DB, user.id, { type: 'idea', message });
	if (!res.ok) throw new Error(`feedback setup failed: ${res.reason}`);
	return res.id;
}

async function feedbackStatus(id: string): Promise<string | undefined> {
	const row = await env.DB.prepare('SELECT status FROM feedback WHERE id = ?')
		.bind(id)
		.first<{ status: string }>();
	return row?.status;
}

function formRequest(fields: Record<string, string>): Request {
	const body = new URLSearchParams(fields);
	return new Request('https://example.com/admin/roadmap', { method: 'POST', body });
}

describe('accepting feedback into the roadmap', () => {
	it('publishes a bilingual entry and closes the submission in one step', async () => {
		const feedbackId = await newFeedback();
		const result = await acceptFeedbackIntoRoadmap(env.DB, feedbackId, {
			titleEn: 'Trip templates',
			titlePt: 'Modelos de viagem',
			status: 'planned',
			noteEn: 'Start a trip from a template.',
			notePt: 'Comece uma viagem a partir de um modelo.'
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const row = await getRoadmapOverlayRow(env.DB, result.id);
		expect(row?.titleEn).toBe('Trip templates');
		expect(row?.titlePt).toBe('Modelos de viagem');
		expect(row?.hidden).toBe(0);
		// Provenance is recorded, so a published entry can always be traced back
		// to the submission it came from.
		expect(row?.feedbackId).toBe(feedbackId);

		// The submission leaves the untriaged queue.
		expect(await feedbackStatus(feedbackId)).toBe('planned');
		const queue = await listFeedbackByStatus(env.DB, 'new');
		expect(queue.some((f) => f.id === feedbackId)).toBe(false);
	});

	it('accepting as shipped closes the submission as done, not planned', async () => {
		const feedbackId = await newFeedback('Already built this one');
		const result = await acceptFeedbackIntoRoadmap(env.DB, feedbackId, {
			titleEn: 'Already shipped thing',
			titlePt: 'Coisa já entregue',
			status: 'shipped'
		});
		expect(result.ok).toBe(true);
		expect(await feedbackStatus(feedbackId)).toBe('done');
		expect(feedbackStatusFor('shipped')).toBe('done');
		expect(feedbackStatusFor('planned')).toBe('planned');
	});

	it('the published entry reaches the public snapshot', async () => {
		const feedbackId = await newFeedback('Show it publicly');
		const result = await acceptFeedbackIntoRoadmap(env.DB, feedbackId, {
			titleEn: 'Publicly visible entry',
			titlePt: 'Entrada visível publicamente',
			status: 'building'
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const merged = mergeRoadmap(baseRoadmap, await listRoadmapOverlay(env.DB));
		const item = merged.items.find((it) => it.id === result.id);
		expect(item?.title.pt).toBe('Entrada visível publicamente');
		expect(item?.status).toBe('building');
	});

	it('rejects a one-sided title and writes nothing at all', async () => {
		const feedbackId = await newFeedback('Half translated');
		const before = await listRoadmapOverlay(env.DB);

		const result = await acceptFeedbackIntoRoadmap(env.DB, feedbackId, {
			titleEn: 'English only',
			titlePt: '   ',
			status: 'planned'
		});
		expect(result).toEqual({ ok: false, reason: 'missing_title' });

		// Nothing published, and the submission stays in the queue so it can't
		// be silently lost by a failed triage.
		expect((await listRoadmapOverlay(env.DB)).length).toBe(before.length);
		expect(await feedbackStatus(feedbackId)).toBe('new');
	});

	it('rejects a note written in only one language', async () => {
		const feedbackId = await newFeedback('Note in one language');
		const result = await acceptFeedbackIntoRoadmap(env.DB, feedbackId, {
			titleEn: 'Fine title',
			titlePt: 'Título aceitável',
			status: 'planned',
			noteEn: 'Only English here'
		});
		expect(result).toEqual({ ok: false, reason: 'half_note' });
		expect(await feedbackStatus(feedbackId)).toBe('new');
	});

	it('rejects an unknown status and an unknown submission', async () => {
		const feedbackId = await newFeedback('Bad status');
		expect(
			await acceptFeedbackIntoRoadmap(env.DB, feedbackId, {
				titleEn: 'T',
				titlePt: 'T',
				status: 'wishlist' as never
			})
		).toEqual({ ok: false, reason: 'bad_status' });

		expect(
			await acceptFeedbackIntoRoadmap(env.DB, 'no-such-feedback', {
				titleEn: 'T',
				titlePt: 'T',
				status: 'planned'
			})
		).toEqual({ ok: false, reason: 'not_found' });
	});
});

describe('editing roadmap entries without touching roadmap.json', () => {
	it('flips a committed snapshot item’s status, preserving its text', async () => {
		// 'app-store' is a real 'planned' item in the committed snapshot.
		const baseItem = baseRoadmap.items.find((it) => it.id === 'app-store');
		expect(baseItem?.status).toBe('planned');

		const result = await patchRoadmapItem(env.DB, 'app-store', { status: 'building' });
		expect(result.ok).toBe(true);

		const row = await getRoadmapOverlayRow(env.DB, 'app-store');
		expect(row?.status).toBe('building');
		// Promoted into the overlay with the snapshot wording carried over —
		// the admin only chose a status, they didn't retype the title.
		expect(row?.titleEn).toBe(baseItem?.title.en);
		expect(row?.titlePt).toBe(baseItem?.title.pt);

		const merged = mergeRoadmap(baseRoadmap, await listRoadmapOverlay(env.DB));
		expect(merged.items.find((it) => it.id === 'app-store')?.status).toBe('building');
	});

	it('retires an item from the public page and restores it again', async () => {
		expect((await patchRoadmapItem(env.DB, 'ownership-transfer', { hidden: true })).ok).toBe(true);
		let merged = mergeRoadmap(baseRoadmap, await listRoadmapOverlay(env.DB));
		expect(merged.items.some((it) => it.id === 'ownership-transfer')).toBe(false);

		expect((await patchRoadmapItem(env.DB, 'ownership-transfer', { hidden: false })).ok).toBe(true);
		merged = mergeRoadmap(baseRoadmap, await listRoadmapOverlay(env.DB));
		expect(merged.items.some((it) => it.id === 'ownership-transfer')).toBe(true);
	});

	it('reverting drops the overlay row so the snapshot definition wins again', async () => {
		await patchRoadmapItem(env.DB, 'approval-emails', { status: 'shipped' });
		expect(await getRoadmapOverlayRow(env.DB, 'approval-emails')).not.toBeNull();

		expect(await deleteRoadmapItem(env.DB, 'approval-emails')).toBe(true);
		expect(await getRoadmapOverlayRow(env.DB, 'approval-emails')).toBeNull();

		const merged = mergeRoadmap(baseRoadmap, await listRoadmapOverlay(env.DB));
		const original = baseRoadmap.items.find((it) => it.id === 'approval-emails');
		expect(merged.items.find((it) => it.id === 'approval-emails')?.status).toBe(original?.status);

		// Deleting something that isn't there reports it rather than pretending.
		expect(await deleteRoadmapItem(env.DB, 'approval-emails')).toBe(false);
	});

	it('patching an id that exists in neither layer is not_found', async () => {
		expect(await patchRoadmapItem(env.DB, 'no-such-item', { status: 'shipped' })).toEqual({
			ok: false,
			reason: 'not_found'
		});
	});
});

describe('generated ids', () => {
	it('slugifies a title, stripping accents and punctuation', () => {
		expect(slugify('Previsão do tempo, por dia!')).toBe('previsao-do-tempo-por-dia');
		expect(slugify('  Trip Templates  ')).toBe('trip-templates');
	});

	it('never collides with a committed snapshot id', async () => {
		// 'dark-mode' already exists in roadmap.json — a new entry with the same
		// title must not silently overwrite it.
		const id = await uniqueRoadmapId(env.DB, 'Dark mode');
		expect(id).not.toBe('dark-mode');
		expect(id.startsWith('dark-mode-')).toBe(true);
	});
});

describe('/admin/roadmap is admin-only', () => {
	it('load: 404 for a signed-in non-admin, data for the admin', async () => {
		const stranger = await approvedUser('stranger@example.com');
		await expect(
			load({ locals: { user: stranger }, platform: platformWith() } as never)
		).rejects.toMatchObject({ status: 404 });

		const admin = await approvedUser(ADMIN_EMAIL);
		const data = await load({ locals: { user: admin }, platform: platformWith() } as never);
		expect(Array.isArray(data.queue)).toBe(true);
		expect(Array.isArray(data.items)).toBe(true);
	});

	it('load: signed-out is redirected home, not shown a 404', async () => {
		await expect(
			load({ locals: { user: null }, platform: platformWith() } as never)
		).rejects.toMatchObject({ status: 302 });
	});

	it('every action rejects a non-admin — a form POST never re-runs load', async () => {
		const stranger = await approvedUser('stranger2@example.com');
		const feedbackId = await newFeedback('Should stay untriaged');
		const ctx = (fields: Record<string, string>) => ({
			request: formRequest(fields),
			locals: { user: stranger },
			platform: platformWith()
		});

		await expect(
			actions.accept(ctx({ feedbackId, titleEn: 'X', titlePt: 'X', status: 'planned' }) as never)
		).rejects.toMatchObject({ status: 404 });
		await expect(actions.dismiss(ctx({ feedbackId }) as never)).rejects.toMatchObject({
			status: 404
		});
		await expect(actions.patch(ctx({ id: 'dark-mode', status: 'planned' }) as never)).rejects.toMatchObject({
			status: 404
		});
		await expect(actions.revert(ctx({ id: 'dark-mode' }) as never)).rejects.toMatchObject({
			status: 404
		});

		// And none of it took effect.
		expect(await feedbackStatus(feedbackId)).toBe('new');
		expect(await getRoadmapOverlayRow(env.DB, 'dark-mode')).toBeNull();
	});

	it('actions: signed-out is a 401', async () => {
		await expect(
			actions.dismiss({
				request: formRequest({ feedbackId: 'x' }),
				locals: { user: null },
				platform: platformWith()
			} as never)
		).rejects.toMatchObject({ status: 401 });
	});
});

describe('/admin/roadmap actions, as the admin', () => {
	it('accept publishes, dismiss closes without publishing', async () => {
		const admin = await approvedUser(ADMIN_EMAIL);
		const platform = platformWith();

		const acceptId = await newFeedback('Publish me');
		const accepted = await actions.accept({
			request: formRequest({
				feedbackId: acceptId,
				titleEn: 'Published from the form',
				titlePt: 'Publicado pelo formulário',
				status: 'planned'
			}),
			locals: { user: admin },
			platform
		} as never);
		expect(accepted).toEqual({ ok: true });
		expect(await feedbackStatus(acceptId)).toBe('planned');
		expect(await getRoadmapOverlayRow(env.DB, 'published-from-the-form')).not.toBeNull();

		const dismissId = await newFeedback('Not for the roadmap');
		const before = (await listRoadmapOverlay(env.DB)).length;
		const dismissed = await actions.dismiss({
			request: formRequest({ feedbackId: dismissId }),
			locals: { user: admin },
			platform
		} as never);
		expect(dismissed).toEqual({ ok: true });
		expect(await feedbackStatus(dismissId)).toBe('dismissed');
		// A dismissal must never reach the public roadmap.
		expect((await listRoadmapOverlay(env.DB)).length).toBe(before);
	});

	it('accept returns the failing submission id so the page can re-open its card', async () => {
		const admin = await approvedUser(ADMIN_EMAIL);
		const feedbackId = await newFeedback('Half a title');
		const result = (await actions.accept({
			request: formRequest({ feedbackId, titleEn: 'Only English', titlePt: '', status: 'planned' }),
			locals: { user: admin },
			platform: platformWith()
		} as never)) as { status: number; data: { errorKey: string; feedbackId: string } };

		expect(result.status).toBe(400);
		expect(result.data.errorKey).toBe('admin.roadmap.error.missing_title');
		expect(result.data.feedbackId).toBe(feedbackId);
		expect(await feedbackStatus(feedbackId)).toBe('new');
	});
});
