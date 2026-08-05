import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { isAdmin } from '$lib/server/admin';
import { listFeedbackByStatus, updateFeedbackStatus } from '$lib/server/feedback';
import {
	acceptFeedbackIntoRoadmap,
	deleteRoadmapItem,
	isRoadmapStatus,
	listAdminRoadmap,
	patchRoadmapItem,
	type RoadmapWriteResult
} from '$lib/server/roadmap';

/** Same posture as /admin/approvals: signed-out users are bounced home, and a
 *  signed-in non-admin gets a 404 rather than a 403 — that a triage queue
 *  exists at all isn't information a regular user needs. Repeated in every
 *  action because a form POST never re-runs `load`. */
function requireAdmin(locals: App.Locals, platform: App.Platform | undefined): void {
	if (!locals.user) throw error(401, 'Sign in required.');
	if (!isAdmin(locals.user, platform)) throw error(404, 'Not found');
}

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user) throw redirect(302, '/');
	if (!isAdmin(locals.user, platform)) throw error(404, 'Not found');
	const db = getDb(platform);
	const [queue, items] = await Promise.all([
		listFeedbackByStatus(db, 'new'),
		listAdminRoadmap(db)
	]);
	return { queue, items };
};

/** Every failure returns the SAME shape — an error message key plus which card
 *  it belongs to — so `form` has one type across all four actions and the page
 *  can re-open just the row that failed instead of collapsing the whole list. */
function formError(
	status: number,
	errorKey: string,
	target: { feedbackId?: string; itemId?: string } = {}
) {
	return fail(status, {
		errorKey,
		feedbackId: target.feedbackId ?? null,
		itemId: target.itemId ?? null
	});
}

/** Map a write failure onto the form-error message key the page renders. */
function failureKey(result: Extract<RoadmapWriteResult, { ok: false }>): string {
	return `admin.roadmap.error.${result.reason}`;
}

export const actions: Actions = {
	// Publish a roadmap entry from a feedback submission and close the
	// submission out, in one D1 batch (see acceptFeedbackIntoRoadmap).
	accept: async ({ request, locals, platform }) => {
		requireAdmin(locals, platform);
		const db = getDb(platform);
		const form = await request.formData();
		const feedbackId = String(form.get('feedbackId') ?? '');
		const status = String(form.get('status') ?? '');
		if (!feedbackId) return formError(400, 'admin.roadmap.error.not_found');
		if (!isRoadmapStatus(status)) return formError(400, 'admin.roadmap.error.bad_status', { feedbackId });

		const result = await acceptFeedbackIntoRoadmap(db, feedbackId, {
			titleEn: String(form.get('titleEn') ?? ''),
			titlePt: String(form.get('titlePt') ?? ''),
			status,
			noteEn: String(form.get('noteEn') ?? ''),
			notePt: String(form.get('notePt') ?? '')
		});
		// The failing submission's id rides back so the page can re-open just
		// that card with its error, instead of collapsing the whole queue.
		if (!result.ok) return formError(400, failureKey(result), { feedbackId });
		return { ok: true };
	},

	// Dismiss without publishing: a status write on the feedback row only —
	// nothing reaches the public roadmap.
	dismiss: async ({ request, locals, platform }) => {
		requireAdmin(locals, platform);
		const db = getDb(platform);
		const form = await request.formData();
		const feedbackId = String(form.get('feedbackId') ?? '');
		if (!feedbackId) return formError(400, 'admin.roadmap.error.not_found');
		await updateFeedbackStatus(db, feedbackId, 'dismissed');
		return { ok: true };
	},

	// Change an existing entry's status, or retire/restore it. Works on base
	// (roadmap.json) items too — patchRoadmapItem promotes them into the
	// overlay on first edit.
	patch: async ({ request, locals, platform }) => {
		requireAdmin(locals, platform);
		const db = getDb(platform);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return formError(400, 'admin.roadmap.error.not_found');

		const rawStatus = form.get('status');
		const rawHidden = form.get('hidden');
		const patch: { status?: 'shipped' | 'building' | 'planned'; hidden?: boolean } = {};
		if (rawStatus !== null) {
			const status = String(rawStatus);
			if (!isRoadmapStatus(status)) return formError(400, 'admin.roadmap.error.bad_status', { itemId: id });
			patch.status = status;
		}
		if (rawHidden !== null) patch.hidden = String(rawHidden) === '1';

		const result = await patchRoadmapItem(db, id, patch);
		if (!result.ok) return formError(400, failureKey(result), { itemId: id });
		return { ok: true };
	},

	// Drop the overlay row: a base item reverts to its roadmap.json definition,
	// an overlay-only entry disappears from the roadmap.
	revert: async ({ request, locals, platform }) => {
		requireAdmin(locals, platform);
		const db = getDb(platform);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return formError(400, 'admin.roadmap.error.not_found');
		const removed = await deleteRoadmapItem(db, id);
		if (!removed) return formError(404, 'admin.roadmap.error.not_found', { itemId: id });
		return { ok: true };
	}
};
