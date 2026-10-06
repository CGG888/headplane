/**
 * Deletion is irreversible, so the row control only opens a confirmation
 * dialog — it never posts on its own. The request is built here, and the
 * builder refuses to produce a payload until the operator has confirmed inside
 * that dialog. Keeping the gate a plain function is what lets the unit tests
 * cover it: the unit project runs in a plain node environment, with no DOM to
 * click through.
 *
 * This module has no imports so the client dialog can use it without pulling
 * server code into the browser bundle.
 */

/** `action_id` the API key action switches on for a deletion. */
export const DELETE_API_KEY_ACTION = "delete_api_key";

export function confirmedDeleteRequest(
  confirmed: boolean,
  entries: Record<string, string>,
): FormData | null {
  if (!confirmed) {
    return null;
  }

  const form = new FormData();
  form.set("action_id", DELETE_API_KEY_ACTION);
  for (const [name, value] of Object.entries(entries)) {
    form.set(name, value);
  }

  return form;
}
