import type { LayoutServerLoad } from './$types';
import { isAdmin } from '$lib/server/admin';
import { getAnthropicKey } from '$lib/server/import';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
	return {
		user: locals.user,
		locale: locals.locale,
		theme: locals.theme,
		// Lets the nav chrome (Sidebar / BottomBar More sheet) show the
		// admin-only Approvals entry. Display-only: every admin route still
		// re-checks isAdmin server-side on load and on every action.
		admin: isAdmin(locals.user, platform),
		// Paste-import calls the Anthropic API, which is only configured when the
		// ANTHROPIC_API_KEY secret is set. Without it every import fails with a
		// 501, so the entry points (home actions, Sidebar, BottomBar) hide rather
		// than lead users into a dead end. Display-only, exactly like `admin`:
		// /api/trips/import re-checks the key itself and still answers 501.
		importEnabled: !!getAnthropicKey(platform)
	};
};
