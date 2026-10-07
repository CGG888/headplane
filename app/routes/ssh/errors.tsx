import { AlertCircle } from "lucide-react";

import Card from "~/components/card";
import Link from "~/components/link";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";

export type SshErrorCode =
  | "wasmMissing"
  | "agentRequired"
  | "oidcRequired"
  | "nodeNotFound"
  | "userNotLinked";

const ANCHORS: Record<SshErrorCode, string> = {
  wasmMissing: "#ssh-not-available",
  agentRequired: "#agent-required",
  oidcRequired: "#oidc-required",
  nodeNotFound: "#node-not-found",
  userNotLinked: "#user-not-linked",
};

const TITLE_KEYS: Record<SshErrorCode, TranslationKey> = {
  wasmMissing: "ssh.errors.wasmMissing.title",
  agentRequired: "ssh.errors.agentRequired.title",
  oidcRequired: "ssh.errors.oidcRequired.title",
  nodeNotFound: "ssh.errors.nodeNotFound.title",
  userNotLinked: "ssh.errors.userNotLinked.title",
};

const MESSAGE_KEYS: Record<SshErrorCode, TranslationKey> = {
  wasmMissing: "ssh.errors.wasmMissing.message",
  agentRequired: "ssh.errors.agentRequired.message",
  oidcRequired: "ssh.errors.oidcRequired.message",
  nodeNotFound: "ssh.errors.nodeNotFound.message",
  userNotLinked: "ssh.errors.userNotLinked.message",
};

/** The translatable message key for a code, for callers outside the boundary. */
export function sshErrorMessageKey(code: SshErrorCode): TranslationKey {
  return MESSAGE_KEYS[code];
}

/** Payload carried by `data(...)` so the boundary can translate the error. */
export interface SshErrorPayload {
  sshError: SshErrorCode;
  params?: Record<string, string>;
}

export function sshError(code: SshErrorCode, params?: Record<string, string>): SshErrorPayload {
  return { sshError: code, params };
}

export function isSshErrorPayload(value: unknown): value is SshErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "sshError" in value &&
    typeof (value as { sshError?: unknown }).sshError === "string" &&
    (value as { sshError: string }).sshError in TITLE_KEYS
  );
}

const DOCS_BASE = "https://cgg888.github.io/headplaneCN/en/features/ssh";

export function SSHErrorBoundary({
  code,
  params,
}: {
  readonly code: SshErrorCode;
  readonly params?: Record<string, string>;
}) {
  const { t } = useI18n();

  return (
    <Card className="w-screen" variant="flat">
      <div className="flex items-center justify-between gap-4">
        <Card.Title>{t(TITLE_KEYS[code])}</Card.Title>
        <AlertCircle className="mb-2 h-6 w-6 text-red-500" />
      </div>
      <Card.Text>
        {t(MESSAGE_KEYS[code], params)}
        <br />
        <br />
        <Link to={`${DOCS_BASE}${ANCHORS[code]}`} external styled>
          {t("ssh.docs")}
        </Link>{" "}
      </Card.Text>
    </Card>
  );
}
