#!/usr/bin/env bash
# =============================================================================
# dual-image-install.sh
#
# Interactive installer for the two-container deployment of Headscale and
# HeadplaneCN described in docs/install/dual-image.md:
#
#   headscale   -> container "headscale"    (image pinned by --headscale-tag)
#   headplaneCN -> container "headplaneCN"  (image pinned by --headplane-tag)
#
# One nested directory holds the whole stack (default /vol1/1000/APP/headplaneCN):
#
#   <base>/docker-compose.yml
#   <base>/.env                  HEADSCALE_VERSION, HEADPLANE_VERSION,
#                                HEADSCALE_UID, HEADSCALE_GID, BASE_DIR,
#                                PANEL_BIND, PANEL_PORT, TZ
#   <base>/config.yaml           HeadplaneCN config -> /etc/headplane/config.yaml (ro)
#   <base>/data/                 HeadplaneCN data   -> /var/lib/headplane (rw)
#   <base>/headscale/            the Headscale directory - its config and ALL
#                                its data: config.yaml, db.sqlite,
#                                noise_private.key, private.key,
#                                derp_server_private.key, headscale.sock,
#                                cache/ and derp-maps/
#   <base>/backup/               timestamped tar.gz backups
#
# The defining property of this shape: <base>/headscale is mounted inside BOTH
# containers at the SAME absolute path, so every absolute path in the Headscale
# config.yaml (noise_private_key_path, database.sqlite.path, derp.paths,
# derp.server.private_key_path, unix_socket, tls_letsencrypt_cache_dir) keeps
# working unchanged - nothing is rewritten to /etc/headscale or
# /var/lib/headscale.  Only the config file itself additionally appears at
# /etc/headscale/config.yaml, which is where the panel reads it.
#
# Both services use network_mode: host, so there is no ports: section and
# 127.0.0.1 inside a container is this machine.  The panel drives the Headscale
# container through the Docker socket (integration.docker) and
# integration.proc is disabled - which is why no security_opt/apparmor override
# is generated: that pair is only needed for the reverse migration to a native
# Headscale, which the documentation describes but this script never writes.
#
# Safety rails:
#   * asks for every environment specific value and validates it before use;
#   * asks for every directory, prints the resolved layout before writing and
#     warns instead of silently accepting two prompts pointing at one path;
#   * refuses to run without docker and the "docker compose" plugin
#     (in --dry-run mode only a warning is printed, because nothing changes);
#   * never deletes or moves existing data: a migration only ever COPIES, and
#     an existing file is backed up before it is replaced;
#   * atomic writes (temp file + mv), chmod 600 on anything holding a secret;
#   * secrets are never echoed back in full (they are masked);
#   * --dry-run prints every file, every copy and every follow-up command and
#     writes nothing outside a private temporary directory;
#   * nothing is started without an explicit confirmation.
#
# Usage:  bash scripts/dual-image-install.sh [options]
#         bash scripts/dual-image-install.sh --help
#
# Human readable prompts and progress go to stderr; the plan, the verification
# output and the final summary go to stdout, so this script can be piped.
# =============================================================================

set -euo pipefail

SCRIPT_NAME="dual-image-install.sh"
SCRIPT_VERSION="2.0.0"

# -----------------------------------------------------------------------------
# Defaults (shown in brackets at each prompt)
# -----------------------------------------------------------------------------
DEFAULT_HS_IMAGE="headscale/headscale:0.29.4"
DEFAULT_HP_IMAGE="ghcr.io/cgg888/headplanecn:0.22.23"
DEFAULT_BASE_DIR="/vol1/1000/APP/headplaneCN"
DEFAULT_SERVER_URL="https://ha.example.com:8443"
DEFAULT_ADMIN_PORT="4100"
DEFAULT_HS_PORT="8480"
# One .env key prefixes every image pull, so a blocked registry is fixed in one
# place instead of three.  It ends with a slash; empty means a direct pull.
DEFAULT_IMAGE_PROXY="v6.gh-proxy.org/docker/"
DEFAULT_IMAGE_PROXY_ALT="v4.gh-proxy.org/docker/"
DEFAULT_CADDY_PORT="8444"
DEFAULT_METRICS_PORT="8481"
DEFAULT_STUN_PORT="3478"
DEFAULT_HS_UID="0"
DEFAULT_HS_GID="0"
DEFAULT_TZ_FALLBACK="Asia/Shanghai"
DEFAULT_DERP_DIR_NAME="derp-maps"
DEFAULT_DERP_MAP_NAME="official-mirror.yaml"
DEFAULT_REGION_ID="999"
DEFAULT_REGION_CODE="headscale"
DEFAULT_REGION_NAME="Headscale Embedded DERP"

# Container paths of the mounted files.  They are fixed by the two images, and
# they are deliberately few: the Headscale directory needs no mapping at all,
# because it is mounted at its own absolute path in both containers.
HS_CONFIG_CTR="/etc/headscale/config.yaml"
HP_CONFIG_CTR="/etc/headplane/config.yaml"
HP_DATA_CTR="/var/lib/headplane"

# -----------------------------------------------------------------------------
# State
# -----------------------------------------------------------------------------
DRY_RUN=0
USE_DEFAULTS=0
SELF_TEST=0
OPT_BASE_DIR=""
OPT_HS_IMAGE=""
OPT_HP_IMAGE=""
OPT_SERVER_URL=""
OPT_DERP_HOST=""
OPT_ADMIN_HOST=""
# --admin-port and --admin-bind kept their flag names; they fill PANEL_PORT and
# PANEL_BIND, which is what the compose file, .env and the panel config use.
OPT_HP_PORT=""
OPT_ADMIN_BIND=""
OPT_STUN_PORT=""
OPT_TZ=""
OPT_REGION_ID=""

# The nested layout: BASE_DIR holds everything, and HS_DIR is the directory that
# is mounted inside both containers at the SAME absolute path, so the absolute
# paths in its config.yaml stay valid.
BASE_DIR=""
ENV_FILE=""
COMPOSE_FILE=""
CADDY_DIR=""
CADDY_FILE=""
IMAGE_PROXY=""
OPT_CADDY_PORT=""
OPT_IMAGE_PROXY=""
BACKUP_DIR=""
HP_CONFIG=""
HP_DATA=""
HS_DIR=""
HS_CONFIG=""
DERP_MAP_DIR=""
LAYOUT_COLLISION=0

HS_IMAGE=""
HP_IMAGE=""
HS_IMAGE_REPO=""
HS_IMAGE_VERSION=""
HP_IMAGE_REPO=""
HP_IMAGE_VERSION=""
SERVER_URL=""
CLIENT_HOST=""
CLIENT_PORT=""
CLIENT_SCHEME=""
DERP_HOST=""
DERP_URL=""
ADMIN_HOST=""
ADMIN_URL=""
BASE_URL=""
PANEL_BIND=""
PANEL_PORT=""
STUN_PORT=""
METRICS_ADDR=""
TZONE=""
REGION_ID=""
REGION_CODE=""
REGION_NAME=""
DERP_MAP_CTR=""
DERP_MAP_HOST=""
# The user the headscale container runs as.  A migrated directory keeps its
# owner, so these are offered in .env instead of being hardcoded to root.
HEADSCALE_UID="$DEFAULT_HS_UID"
HEADSCALE_GID="$DEFAULT_HS_GID"
API_KEY=""
API_KEY_STATE=""
COOKIE_SECRET=""
COOKIE_STATE=""
KEEP_COOKIE=0
MIGRATE_SRC=""
MIGRATE_ACTIVE=0
START_NOW=0
ROOT_UID=0
HAVE_OPENSSL=0
HAVE_CURL=0
RUN_TS=""
RUN_STAMP=""

TMP_ROOT=""
STAGE_DIR=""
declare -a TMP_FILES=()
declare -a TMP_DIRS=()
declare -a WRITTEN_FILES=()
declare -a COPIED_FILES=()
declare -a BACKUP_FILES=()
declare -a PLAN_NOTES=()
declare -a CHANGES=()

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
if [[ -t 2 ]]; then
	C_BOLD=$'\033[1m'
	C_DIM=$'\033[2m'
	C_RED=$'\033[31m'
	C_YEL=$'\033[33m'
	C_GRN=$'\033[32m'
	C_OFF=$'\033[0m'
else
	C_BOLD=""
	C_DIM=""
	C_RED=""
	C_YEL=""
	C_GRN=""
	C_OFF=""
fi

say() { printf '%s\n' "$*" >&2; }
head2() { printf '\n%s== %s ==%s\n' "$C_BOLD" "$*" "$C_OFF" >&2; }
info() { printf '%s\n' "$*" >&2; }
dim() { printf '%s%s%s\n' "$C_DIM" "$*" "$C_OFF" >&2; }
ok() { printf '%s%s%s\n' "$C_GRN" "$*" "$C_OFF" >&2; }
warn() { printf '%sWARNING:%s %s\n' "$C_YEL" "$C_OFF" "$*" >&2; }
verr() { printf '  %sinvalid:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; }
err() { printf '%sERROR:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; }
die() {
	printf '%sERROR:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2
	exit 1
}
emit() { printf '%s\n' "$*"; }
emit_raw() { printf '%s' "$*"; }

# -----------------------------------------------------------------------------
# Temp files / cleanup.  There is no "rm -rf" anywhere in this script: every
# temporary file is registered and removed by name, then its directory is
# removed with rmdir (which only ever removes an empty directory).
# -----------------------------------------------------------------------------
cleanup() {
	local rc=$?
	trap - EXIT
	local f d i
	if ((${#TMP_FILES[@]} > 0)); then
		for f in "${TMP_FILES[@]}"; do
			[[ -n $f && -e $f ]] && rm -f "$f" 2>/dev/null || true
		done
	fi
	if ((${#TMP_DIRS[@]} > 0)); then
		for ((i = ${#TMP_DIRS[@]} - 1; i >= 0; i--)); do
			d="${TMP_DIRS[$i]}"
			[[ -n $d && -d $d ]] && rmdir "$d" 2>/dev/null || true
		done
	fi
	exit "$rc"
}

new_tmp_file() {
	local d="${1:-$TMP_ROOT}" f
	f="$(mktemp "$d/.dii.XXXXXX")"
	TMP_FILES+=("$f")
	printf '%s' "$f"
}

new_tmp_dir() {
	local d
	d="$(mktemp -d "${TMPDIR:-/tmp}/dual-image-install.XXXXXX")"
	TMP_DIRS+=("$d")
	printf '%s' "$d"
}

# -----------------------------------------------------------------------------
# Small helpers
# -----------------------------------------------------------------------------
trim() {
	local s="$1"
	s="${s#"${s%%[![:space:]]*}"}"
	s="${s%"${s##*[![:space:]]}"}"
	printf '%s' "$s"
}

norm_path() {
	local p="$1"
	while [[ $p == */ && $p != "/" ]]; do
		p="${p%/}"
	done
	printf '%s' "$p"
}

# Deepest ancestor of a path that already exists (used to decide whether the
# installer would be able to create it without touching anything).
path_deepest_existing() {
	local p="$1"
	while [[ ! -e $p && $p != "/" ]]; do
		p="$(dirname "$p")"
	done
	printf '%s' "$p"
}

mask_secret() {
	local v="${1-}"
	local n=${#v}
	if ((n == 0)); then
		printf '(empty)'
	elif ((n <= 8)); then
		printf '********'
	else
		printf '%s...%s (len %d, masked)' "${v:0:4}" "${v: -2}" "$n"
	fi
}

mask_config_lines() {
	sed -E 's/^([[:space:]]*(api_key|cookie_secret|client_secret|info_secret)[[:space:]]*:).*/\1 "<redacted>"/'
}

# The change log is printed on every run, so a key that holds a secret has to be
# masked there as well - the same value is written to the file in full.
is_secret_key() {
	case "$1" in
	*secret* | *api_key* | *password* | *passwd* | *token*) return 0 ;;
	*) return 1 ;;
	esac
}

have() { command -v "$1" >/dev/null 2>&1; }

is_uint() {
	local v="$1"
	[[ $v =~ ^[0-9]+$ ]]
}

# Rejects characters that would break YAML quoting or heredoc interpolation.
# Every free text answer goes through this once, so values can be interpolated
# into generated files safely.
reject_special() {
	local v="$1" what="$2"
	if [[ $v == *$'\n'* || $v == *$'\t'* ]]; then
		verr "$what must not contain tabs or newlines"
		return 1
	fi
	if [[ $v == *'"'* || $v == *'\'* || $v == *'$'* || $v == *'`'* ]]; then
		verr "$what must not contain quotes, backslashes, dollar signs or backticks"
		return 1
	fi
	if [[ $v != "$(trim "$v")" ]]; then
		verr "$what must not start or end with whitespace"
		return 1
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Validators.  Each prints its own reason and returns non-zero on failure.
# -----------------------------------------------------------------------------
v_abs_path() {
	local v="$1"
	[[ -n $v ]] || { verr "path is empty"; return 1; }
	[[ $v == /* ]] || { verr "path must be absolute and start with / (got '$v')"; return 1; }
	[[ $v == *"//"* ]] && { verr "path must not contain //"; return 1; }
	case "/$v/" in
	*/../*) { verr "path must not contain a .. component"; return 1; } ;;
	esac
	[[ $v == "/" ]] && { verr "the filesystem root is not a valid deployment directory"; return 1; }
	reject_special "$v" "path" || return 1
	return 0
}

# A directory the installer has to create or write in.  Nothing is created here:
# only the deepest existing ancestor is probed, so --dry-run stays read-only and
# the directories are created later with the mode each one needs.
v_host_dir() {
	local v="$1" probe
	v_abs_path "$v" || return 1
	if [[ -e $v && ! -d $v ]]; then
		verr "exists and is not a directory: $v"
		return 1
	fi
	probe="$(path_deepest_existing "$v")"
	if [[ ! -w $probe ]]; then
		verr "'$probe' is not writable by $(id -un), so $v cannot be created; choose another path or re-run with sudo"
		return 1
	fi
	return 0
}

# A file the installer has to create or rewrite (its directory is created too).
v_host_file() {
	local v="$1" probe
	v_abs_path "$v" || return 1
	if [[ -d $v ]]; then
		verr "is a directory; this prompt asks for a file path: $v"
		return 1
	fi
	if [[ -e $v ]]; then
		[[ -w $v ]] || { verr "exists but is not writable by $(id -un): $v"; return 1; }
		return 0
	fi
	probe="$(path_deepest_existing "$(dirname "$v")")"
	if [[ ! -w $probe ]]; then
		verr "'$probe' is not writable by $(id -un), so $v cannot be created; choose another path or re-run with sudo"
		return 1
	fi
	return 0
}

# The DERP map directory has to stay inside the Headscale config directory: that
# is the directory both containers mount, so the map file is then visible at the
# same container path in both services without an extra volume entry.
v_derp_dir() {
	local v="$1"
	v_host_dir "$v" || return 1
	case "$v" in
	"$HS_DIR" | "$HS_DIR"/*) return 0 ;;
	*)
		verr "the DERP map directory must be $HS_DIR or a directory inside it (that directory is mounted at the same absolute path in both containers)"
		return 1
		;;
	esac
}

# Refuses a target of the recursive `chown -R 0:0` below.  A recursive chown
# overwrites ownership that nothing records, so it is only acceptable for a
# directory that exists for this deployment: a system directory, the deployment
# root or the HeadplaneCN data directory would take unrelated files with it.
v_recursive_chown_target() {
	local v="$1" d
	local -a system_dirs=(
		/ /etc /usr /bin /sbin /lib /lib64 /lib32 /boot /var /root /tmp /dev
		/proc /sys /run /home /opt /srv /mnt /media /lost+found
	)
	for d in "${system_dirs[@]}"; do
		if [[ $v == "$d" ]]; then
			verr "'$v' is a system directory; refusing to change its ownership recursively"
			return 1
		fi
	done
	if [[ $v == "$BASE_DIR" ]]; then
		verr "'$v' is the deployment root and also holds the HeadplaneCN files; refusing to change its ownership recursively"
		return 1
	fi
	case "$BASE_DIR" in
	"$v"/*)
		verr "'$v' is a parent of the deployment root ($BASE_DIR), so a recursive chown would also take ownership of unrelated files; pick a dedicated directory"
		return 1
		;;
	esac
	local -a headplane_paths=("$HP_DATA" "$HP_CONFIG")
	for d in "${headplane_paths[@]}"; do
		if [[ -n $d && $v == "$d" ]]; then
			verr "'$v' is a HeadplaneCN path; those are written by the HeadplaneCN container as its own user and must keep their owner"
			return 1
		fi
	done
	return 0
}

# Two prompts pointing at the same place must never pass silently: the containers
# would then share one directory that is read-write in one service and read-only
# in the other.
warn_layout_collisions() {
	local -a lnames=("Headscale directory" "HeadplaneCN data directory" "DERP map directory")
	local -a lpaths=("$HS_DIR" "$HP_DATA" "$DERP_MAP_DIR")
	local i j d
	LAYOUT_COLLISION=0
	for ((i = 0; i < ${#lpaths[@]}; i++)); do
		for ((j = i + 1; j < ${#lpaths[@]}; j++)); do
			[[ ${lpaths[i]} == "${lpaths[j]}" ]] || continue
			LAYOUT_COLLISION=1
			warn "${lnames[i]} and ${lnames[j]} are the same path (${lpaths[i]}): a directory cannot be mounted twice from one place"
		done
		for d in "$HS_CONFIG" "$HP_CONFIG"; do
			if [[ $d == "${lpaths[i]}" ]]; then
				LAYOUT_COLLISION=1
				warn "the file $d and ${lnames[i]} are the same path (${lpaths[i]}): a file and a directory cannot share a path"
			fi
		done
	done
	if ((LAYOUT_COLLISION)); then
		warn "point the prompts at different directories unless that is really what you want (the plan repeats the resolved layout)"
	fi
	return 0
}

v_image_ref() {
	local v="$1" repo tag last
	[[ -n $v ]] || { verr "image reference is empty"; return 1; }
	[[ $v == *:* ]] || { verr "image must be written as repo:tag (no :tag found)"; return 1; }
	last="${v##*/}"
	[[ $last == *:* ]] || { verr "the tag must come after the repository, e.g. ghcr.io/owner/name:1.2.3"; return 1; }
	repo="${v%:*}"
	tag="${v##*:}"
	[[ -n $repo ]] || { verr "repository part is empty"; return 1; }
	[[ -n $tag ]] || { verr "tag part is empty"; return 1; }
	[[ $tag =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]] || { verr "tag '$tag' contains invalid characters"; return 1; }
	[[ $tag != "latest" ]] || { verr "do not pin 'latest': the guide requires an explicit version tag"; return 1; }
	[[ $repo =~ ^[A-Za-z0-9]([A-Za-z0-9._/-]*[A-Za-z0-9])?$ ]] || { verr "repository '$repo' contains invalid characters"; return 1; }
	[[ $repo != *".."* ]] || { verr "repository must not contain .."; return 1; }
	reject_special "$v" "image reference" || return 1
	return 0
}

# --image-proxy takes a bare registry prefix such as v6.gh-proxy.org/docker/.
# "off", "none" and "-" mean a direct pull, which is stored as an empty value.
v_image_proxy() {
	local v="$1" bare
	case "${v,,}" in
	"" | off | none | - | 0) return 0 ;;
	esac
	v="${v#http://}"
	v="${v#https://}"
	v="${v##/}"
	bare="${v%/}"
	[[ $bare =~ ^[A-Za-z0-9]([A-Za-z0-9._/-]*[A-Za-z0-9])?$ ]] ||
		{ verr "image proxy '$1' is not a registry prefix such as v6.gh-proxy.org/docker/"; return 1; }
	[[ $bare != *".."* ]] || { verr "image proxy '$1' must not contain .."; return 1; }
	reject_special "$v" "image proxy" || return 1
	return 0
}

# The canonical form written to .env: no scheme, exactly one trailing slash.
normalize_image_proxy() {
	local v="${1:-}" bare
	case "${v,,}" in
	"" | off | none | - | 0) printf '\n'; return 0 ;;
	esac
	v="${v#http://}"
	v="${v#https://}"
	v="${v##/}"
	bare="${v%/}"
	printf '%s/\n' "$bare"
	return 0
}

v_port() {
	local v="$1"
	is_uint "$v" || { verr "port must be a number (got '$v')"; return 1; }
	((v >= 1 && v <= 65535)) || { verr "port must be between 1 and 65535 (got $v)"; return 1; }
	return 0
}

v_hostname() {
	local v="$1" l
	local -a labels=()
	[[ -n $v ]] || { verr "hostname is empty"; return 1; }
	reject_special "$v" "hostname" || return 1
	if [[ $v =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
		local IFS='.'
		for l in $v; do
			((10#$l <= 255)) || { verr "'$v' is not a valid IPv4 address"; return 1; }
		done
		return 0
	fi
	[[ $v != *..* ]] || { verr "hostname must not contain an empty label"; return 1; }
	[[ $v != .* && $v != *. ]] || { verr "hostname must not start or end with a dot"; return 1; }
	[[ ${#v} -le 253 ]] || { verr "hostname is longer than 253 characters"; return 1; }
	local IFS='.'
	read -r -a labels <<<"$v"
	for l in "${labels[@]}"; do
		[[ ${#l} -ge 1 && ${#l} -le 63 ]] || { verr "label '$l' must be 1-63 characters"; return 1; }
		[[ $l =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || { verr "label '$l' is not a valid DNS label"; return 1; }
	done
	if ((${#labels[@]} > 1)); then
		l="${labels[${#labels[@]} - 1]}"
		[[ $l =~ ^[A-Za-z]{2,}$ ]] || { verr "top level domain '$l' must be alphabetic"; return 1; }
	fi
	return 0
}

# https://host[:port] - no path, no query.
v_http_url() {
	local v="$1" rest hostport host port
	reject_special "$v" "URL" || return 1
	[[ $v == http://* || $v == https://* ]] || { verr "URL must start with http:// or https://"; return 1; }
	rest="${v#*://}"
	[[ -n $rest ]] || { verr "URL has no host"; return 1; }
	[[ $rest != *"/"* ]] && : || { verr "URL must not contain a path (no trailing / either)"; return 1; }
	[[ $rest != *"?"* && $rest != *"#"* ]] || { verr "URL must not contain a query or fragment"; return 1; }
	hostport="$rest"
	host="$hostport"
	port=""
	if [[ $hostport == *:* ]]; then
		host="${hostport%:*}"
		port="${hostport##*:}"
	fi
	v_hostname "$host" || return 1
	[[ -n $port ]] && { v_port "$port" || return 1; }
	return 0
}

# host[:port] | none | direct
v_host_port_opt() {
	local v="$1" host port
	[[ $v == "none" || $v == "direct" ]] && return 0
	reject_special "$v" "hostname" || return 1
	host="$v"
	port=""
	if [[ $v == *:* ]]; then
		host="${v%:*}"
		port="${v##*:}"
	fi
	v_hostname "$host" || return 1
	[[ -n $port ]] && { v_port "$port" || return 1; }
	return 0
}

v_tz() {
	local v="$1"
	[[ -n $v ]] || { verr "timezone is empty"; return 1; }
	reject_special "$v" "timezone" || return 1
	[[ $v =~ ^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$ ]] || { verr "timezone must look like Area/City (or UTC)"; return 1; }
	if [[ -d /usr/share/zoneinfo ]]; then
		[[ -e "/usr/share/zoneinfo/$v" ]] || { verr "no such zone in /usr/share/zoneinfo: $v"; return 1; }
	fi
	return 0
}

v_secret32() {
	local v="$1"
	[[ -n $v ]] || { verr "secret is empty"; return 1; }
	if ((${#v} != 32)); then
		verr "secret must be exactly 32 characters (got ${#v}); generate one with: openssl rand -base64 24"
		return 1
	fi
	reject_special "$v" "secret" || return 1
	return 0
}

v_nonempty() {
	local v="$1"
	[[ -n $v ]] || { verr "value must not be empty"; return 1; }
	reject_special "$v" "value" || return 1
	return 0
}

v_region_id() {
	local v="$1"
	is_uint "$v" || { verr "region id must be a positive number"; return 1; }
	((v >= 1 && v <= 65535)) || { verr "region id must be between 1 and 65535"; return 1; }
	return 0
}

v_container_path() {
	local v="$1"
	v_abs_path "$v" || return 1
	case "$v" in
	"/etc/headscale/config.yaml" | "$HS_DIR" | "$HS_DIR"/*) return 0 ;;
	*)
		verr "path must be $HS_DIR or below it (that directory is mounted at the same absolute path in both containers), not '$v'"
		return 1
		;;
	esac
}

# The panel binds one address directly on the host (network_mode: host), so a
# hostname could not work: accept 0.0.0.0, 127.0.0.1 or a literal IPv4 address.
v_bind_addr() {
	local v="$1" a b c d
	[[ -n $v ]] || { verr "address must not be empty"; return 1; }
	if [[ $v == "0.0.0.0" || $v == "127.0.0.1" ]]; then
		return 0
	fi
	if [[ $v =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
		a="${BASH_REMATCH[1]}"
		b="${BASH_REMATCH[2]}"
		c="${BASH_REMATCH[3]}"
		d="${BASH_REMATCH[4]}"
		if ((10#$a <= 255 && 10#$b <= 255 && 10#$c <= 255 && 10#$d <= 255)); then
			return 0
		fi
		verr "'$v' is not a valid IPv4 address"
		return 1
	fi
	verr "must be 0.0.0.0, 127.0.0.1 or a literal IPv4 address such as 192.168.1.10, not '$v'"
	return 1
}

# -----------------------------------------------------------------------------
# Input helpers
# -----------------------------------------------------------------------------
read_input() { # outvar prompt [default]
	# NOTE: the internal variable is deliberately named __dii_line.  read_input
	# is called with the *caller's* variable name (for example "__reply"), and
	# "printf -v name" resolves in the innermost scope that defines it, so an
	# internal local with the same name would swallow the answer.
	local __dii_out="$1" __dii_prompt="$2" __dii_default="${3-}" __dii_line=""
	if ((USE_DEFAULTS)) && [[ -n $__dii_default ]]; then
		printf '%s [%s]: %s (--defaults)\n' "$__dii_prompt" "$__dii_default" "$__dii_default" >&2
		printf -v "$__dii_out" '%s' "$__dii_default"
		return 0
	fi
	if [[ -n $__dii_default ]]; then
		printf '%s [%s]: ' "$__dii_prompt" "$__dii_default" >&2
	else
		printf '%s: ' "$__dii_prompt" >&2
	fi
	if IFS= read -r __dii_line; then
		:
	else
		if [[ -n $__dii_default ]]; then
			printf '\n' >&2
			warn "standard input is closed (EOF); using the default value"
			__dii_line="$__dii_default"
		else
			die "standard input is closed (EOF) and this prompt has no default: $__dii_prompt"
		fi
	fi
	if [[ -z $__dii_line && -n $__dii_default ]]; then
		__dii_line="$__dii_default"
	fi
	printf -v "$__dii_out" '%s' "$__dii_line"
	return 0
}

read_secret() { # outvar prompt
	local __dii_out="$1" __dii_prompt="$2" __dii_line=""
	printf '%s (input hidden): ' "$__dii_prompt" >&2
	if IFS= read -rs __dii_line; then
		printf '\n' >&2
	else
		die "standard input is closed (EOF) while reading: $__dii_prompt"
	fi
	printf -v "$__dii_out" '%s' "$__dii_line"
	return 0
}

ask() { # outvar prompt default validator
	local __out="$1" __prompt="$2" __default="${3-}" __fn="$4" __reply="" __tries=0
	while :; do
		read_input __reply "$__prompt" "$__default"
		if "$__fn" "$__reply"; then
			printf -v "$__out" '%s' "$__reply"
			return 0
		fi
		__tries=$((__tries + 1))
		if ((__tries >= 5)); then
			if [[ -n $__default ]] && "$__fn" "$__default" 2>/dev/null; then
				warn "too many invalid answers; falling back to the default"
				printf -v "$__out" '%s' "$__default"
				return 0
			fi
			die "too many invalid answers for: $__prompt"
		fi
	done
}

confirm() { # prompt default(y|n)
	local __prompt="$1" __default="${2:-n}" __reply="" __tries=0
	if ((USE_DEFAULTS)); then
		printf '%s [%s]: %s (--defaults)\n' "$__prompt" "$__default" "$__default" >&2
		[[ $__default == y* ]] && return 0 || return 1
	fi
	while :; do
		read_input __reply "$__prompt (y/n)" "$__default"
		case "$__reply" in
		y | Y | yes | YES | Yes) return 0 ;;
		n | N | no | NO | No) return 1 ;;
		*) verr "answer y or n" ;;
		esac
		__tries=$((__tries + 1))
		if ((__tries >= 5)); then
			warn "too many unusable answers; using the default '$__default'"
			[[ $__default == y* ]] && return 0 || return 1
		fi
	done
}

choose_index() { # outvar prompt default_index label...
	local __out="$1" __prompt="$2" __default="$3"
	shift 3
	local -a __opts=("$@")
	local i=1 __o __reply="" __tries=0
	if ((USE_DEFAULTS)); then
		printf '%s [%s]: %s (--defaults)\n' "$__prompt" "$__default" "$__default" >&2
		printf -v "$__out" '%s' "$__default"
		return 0
	fi
	while :; do
		printf '%s\n' "$__prompt" >&2
		i=1
		for __o in "${__opts[@]}"; do
			printf '  %d) %s\n' "$i" "$__o" >&2
			i=$((i + 1))
		done
		read_input __reply "Choose" "$__default"
		if is_uint "$__reply" && ((${#__reply} > 0)) && ((__reply >= 1 && __reply <= ${#__opts[@]})); then
			printf -v "$__out" '%s' "$__reply"
			return 0
		fi
		verr "enter a number between 1 and ${#__opts[@]}"
		__tries=$((__tries + 1))
		if ((__tries >= 5)); then
			warn "too many unusable answers; using option $__default"
			printf -v "$__out" '%s' "$__default"
			return 0
		fi
	done
}

# -----------------------------------------------------------------------------
# YAML reading (best effort) and patching.  Both awk programs are kept in
# variables so no shell quoting can mangle them.
# -----------------------------------------------------------------------------
AWK_YAML_GET=$(
	cat <<'AWK'
function trim(s) { gsub(/^[ \t]+/, "", s); gsub(/[ \t]+$/, "", s); return s }
function strip_comment(v,   q) {
  if (v ~ /^"/) {
    q = index(substr(v, 2), "\"")
    if (q > 0) return substr(v, 1, q + 1)
    return v
  }
  if (v ~ /^'/) {
    q = index(substr(v, 2), "'")
    if (q > 0) return substr(v, 1, q + 1)
    return v
  }
  sub(/[ \t]+#.*$/, "", v)
  return v
}
{
  line = $0
  if (line ~ /^[ \t]*(#|$)/) next
  match(line, /^[ \t]*/); ind = RLENGTH
  body = substr(line, ind + 1)
  if (body !~ /^[A-Za-z0-9_.-]+[ \t]*:/) next
  k = body; sub(/[ \t]*:.*$/, "", k)
  v = body; sub(/^[^:]*:[ \t]*/, "", v)
  v = trim(strip_comment(v))
  while (depth > 0 && blockind[depth] >= ind) depth--
  if (v == "") { depth++; blockkey[depth] = k; blockind[depth] = ind; next }
  p = ""
  for (i = 1; i <= depth; i++) p = p blockkey[i] "."
  p = p k
  if (p == target) {
    sub(/^"/, "", v); sub(/"$/, "", v)
    sub(/^'/, "", v); sub(/'$/, "", v)
    print v
    exit
  }
}
AWK
)

# The items of one list block, one per line.  Used to check derp.paths before the
# install finishes: Headscale exits at start-up when a listed map is unreadable.
AWK_YAML_LIST=$(
	cat <<'AWK'
function trim(s) { gsub(/^[ \t]+/, "", s); gsub(/[ \t]+$/, "", s); return s }
function strip_comment(v,   q) {
  if (v ~ /^"/) {
    q = index(substr(v, 2), "\"")
    if (q > 0) return substr(v, 1, q + 1)
    return v
  }
  if (v ~ /^'/) {
    q = index(substr(v, 2), "'")
    if (q > 0) return substr(v, 1, q + 1)
    return v
  }
  sub(/[ \t]+#.*$/, "", v)
  return v
}
function unquote(v) {
  sub(/^"/, "", v); sub(/"$/, "", v)
  sub(/^'/, "", v); sub(/'$/, "", v)
  return v
}
{
  line = $0
  if (line ~ /^[ \t]*(#|$)/) next
  match(line, /^[ \t]*/); ind = RLENGTH
  body = substr(line, ind + 1)
  if (body ~ /^-([ \t]|$)/) {
    if (inblock && ind > bind) {
      item = body; sub(/^-[ \t]*/, "", item)
      print unquote(trim(strip_comment(item)))
    }
    next
  }
  if (body !~ /^[A-Za-z0-9_.-]+[ \t]*:/) next
  k = body; sub(/[ \t]*:.*$/, "", k)
  v = body; sub(/^[^:]*:[ \t]*/, "", v)
  v = trim(strip_comment(v))
  while (depth > 0 && blockind[depth] >= ind) depth--
  p = ""
  for (i = 1; i <= depth; i++) p = p (i > 1 ? "." : "") blockkey[i]
  if (v == "") {
    depth++; blockkey[depth] = k; blockind[depth] = ind
    p = p (depth > 1 ? "." : "") k
    inblock = (p == target); bind = ind
  } else {
    inblock = ((p == "" ? "" : p ".") k == target)
  }
}
AWK
)

AWK_PATCH=$(
	cat <<'AWK'
function spaces(n,   s, i) { s = ""; for (i = 0; i < n; i++) s = s " "; return s }
function logit(kind, p, old, new, note) {
  printf "%s\t%s\t%s\t%s\t%s\n", kind, p, old, new, note >> logfile
}
function block_end(idx,   j) {
  for (j = idx + 1; j <= N; j++) {
    if (content[j] && indent[j] <= indent[idx]) return j - 1
  }
  return N
}
function snippet(from, to, baseind, mode,   i, s, ind) {
  s = ""; ind = baseind
  for (i = from; i <= to; i++) {
    if (i < to) { s = s spaces(ind) part[i] ":\n"; ind = ind + 2 }
    else if (mode == "list") { s = s spaces(ind) part[i] ":\n" spaces(ind + 2) "- " sval[si] "\n" }
    else { s = s spaces(ind) part[i] ": " quote(sval[si], mode) "\n" }
  }
  return s
}
function quote(v, mode) {
  if (mode == "raw") return v
  return "\"" v "\""
}
function unquote(v) {
  sub(/^"/, "", v); sub(/"$/, "", v)
  sub(/^'/, "", v); sub(/'$/, "", v)
  return v
}
function strip_comment(v,   q) {
  if (v ~ /^"/) {
    q = index(substr(v, 2), "\"")
    if (q > 0) return substr(v, 1, q + 1)
    return v
  }
  if (v ~ /^'/) {
    q = index(substr(v, 2), "'")
    if (q > 0) return substr(v, 1, q + 1)
    return v
  }
  sub(/[ \t]+#.*$/, "", v)
  return v
}
# True for a derp.paths entry the container cannot read.  The Headscale directory
# is mounted at the SAME absolute path, so any absolute path inside it is always
# there - but a path outside it (typically /vol1/@appdata/headscale/... from the
# installation being migrated) is not, and Headscale exits at start-up when a
# listed map cannot be read.
function unreadable(p) {
  if (p !~ /^\//) return 0
  if (p == hs_dir || index(p, hs_dir "/") == 1) return 0
  return 1
}
function find_block(path,   j, best) {
  best = 0
  for (j = 1; j <= N; j++) {
    if (content[j] && path_of[j] == path && val[j] == "") best = j
  }
  return best
}
function join_path(parts, upto,   m, s) {
  s = ""
  for (m = 1; m <= upto; m++) s = s (m > 1 ? "." : "") parts[m]
  return s
}
# Deepest ancestor of "path" that can hold new keys.  Returns
# "depth SUBSEP insert_index SUBSEP kind SUBSEP indent" where kind is "r" for a
# block that already exists in the file (its indent is read from indent[]) or
# "v" for a block created by an earlier insertion in this same run.
function deep_ancestor(path,   n, parts, k, anc, best) {
  n = split(path, parts, ".")
  for (k = n - 1; k >= 1; k--) {
    anc = join_path(parts, k)
    best = find_block(anc)
    if (best > 0) return (k SUBSEP best SUBSEP "r" SUBSEP 0)
    if (anc in vpos) return (k SUBSEP vpos[anc] SUBSEP "v" SUBSEP vindent[anc])
  }
  return ""
}
# Remember the blocks a freshly inserted snippet created, so the next missing
# key nests inside the same block instead of starting a duplicate block.
function register_virtual(from, to, baseind, mode,   i, p) {
  for (i = from; i <= to; i++) {
    if (i == to && mode != "list") continue
    p = join_path(part, i)
    vpos[p] = vcur
    vindent[p] = baseind + 2 * (i - from)
  }
}
# "eof" is a bucket of its own: text appended at the end of the file must never
# be merged with text appended to the last existing block, or the indentation
# would nest the two pieces inside each other.
function append_insert(where, text) {
  if (where == "eof") eof_insert = eof_insert text
  else insert_after[where] = insert_after[where] text
}
BEGIN {
  while ((getline sline < specfile) > 0) {
    if (sline == "") continue
    nf = split(sline, f, "\t")
    if (nf < 3) continue
    ns++
    spath[ns] = f[1]; smode[ns] = f[2]; sval[ns] = f[3]
  }
  close(specfile)
  N = 0
}
{
  N++
  raw[N] = $0
  content[N] = 1
  line = $0
  if (line ~ /^[ \t]*(#|$)/) { content[N] = 0; next }
  match(line, /^[ \t]*/); ind = RLENGTH
  indent[N] = ind
  body = substr(line, ind + 1)
  if (body !~ /^[A-Za-z0-9_.-]+[ \t]*:/) { content[N] = 0; next }
  k = body; sub(/[ \t]*:.*$/, "", k)
  v = body; sub(/^[^:]*:[ \t]*/, "", v)
  v = strip_comment(v)
  sub(/[ \t]+$/, "", v)
  key[N] = k; val[N] = v
  while (depth > 0 && blockind[depth] >= ind) depth--
  if (v == "") {
    depth++
    blockkey[depth] = k; blockind[depth] = ind
    pp = ""
    for (i = 1; i <= depth; i++) pp = pp (i > 1 ? "." : "") blockkey[i]
    path_of[N] = pp
  } else {
    pp = ""
    for (i = 1; i <= depth; i++) pp = pp blockkey[i] "."
    path_of[N] = pp k
  }
}
END {
  for (si = 1; si <= ns; si++) {
    leaf = 0
    for (j = 1; j <= N; j++) {
      if (content[j] && path_of[j] == spath[si]) leaf = j
    }

    if (leaf > 0 && val[leaf] != "") {
      if (smode[si] == "list") {
        logit("MANUAL", spath[si], val[leaf], sval[si], "expected a list block but the key holds a scalar; edit it by hand")
        continue
      }
      cur = unquote(val[leaf])
      if (cur == sval[si]) continue
      newval[leaf] = quote(sval[si], smode[si])
      logit("CHANGE", spath[si], val[leaf], quote(sval[si], smode[si]), "")
      continue
    }

    if (leaf > 0 && val[leaf] == "") {
      if (smode[si] == "list") {
        be = block_end(leaf)
        found = 0; stale = 0
        pdir = sval[si]; sub(/\/[^\/]*$/, "", pdir)
        for (j = leaf + 1; j <= be; j++) {
          item = raw[j]
          if (item !~ /^[ \t]*-[ \t]*/) continue
          sub(/^[ \t]*-[ \t]*/, "", item); sub(/[ \t]+$/, "", item)
          item = unquote(strip_comment(item))
          if (item == sval[si]) found = 1
          if (unreadable(item)) {
            stale++
            stale_line[stale] = j
            sold[stale] = item
          } else {
            kept[item] = 1
          }
        }
        if (found) continue
        primary = 0
        # Every unreadable entry was placed next to the map the installer writes
        # (migration copies derp-maps/ there), so point the line at that copy
        # instead of leaving a path the container cannot open.
        for (st = 1; st <= stale; st++) {
          j = stale_line[st]
          base = sold[st]; sub(/^.*\//, "", base)
          mapped = pdir "/" base
          if (mapped == sval[si]) primary = 1
          if (mapped in kept) {
            dropped[j] = 1
            logit("DROP", spath[si], sold[st], "", "another entry resolves to the same file; loading it twice would duplicate the maps")
            continue
          }
          kept[mapped] = 1
          raw[j] = spaces(indent[leaf] + 2) "- " mapped
          logit("CHANGE", spath[si], sold[st], mapped, "old host path rewritten to the map inside the mounted config directory")
        }
        if (!primary) {
          insert_after[be] = insert_after[be] spaces(indent[leaf] + 2) "- " sval[si] "\n"
          logit("ADD", spath[si], "(not listed)", sval[si], "")
        }
        continue
      }
      logit("MANUAL", spath[si], "(block)", sval[si], "key exists as a block; not rewritten automatically")
      continue
    }

    n = split(spath[si], part, ".")
    placed = 0
    anc = deep_ancestor(spath[si])
    if (anc != "") {
      split(anc, ap, SUBSEP)
      k = ap[1] + 0; pos = ap[2]
      if (ap[3] == "v") base = (ap[4] + 0) + 2
      else base = indent[pos + 0] + 2
      vcur = pos
      append_insert(pos, snippet(k + 1, n, base, smode[si]))
      register_virtual(k + 1, n, base, smode[si])
      placed = 1
    }
    if (!placed) {
      vcur = "eof"
      append_insert("eof", snippet(1, n, 0, smode[si]))
      register_virtual(1, n, 0, smode[si])
    }
    logit("ADD", spath[si], "(absent)", quote(sval[si], smode[si]), "")
  }

  for (j = 1; j <= N; j++) {
    if (j in dropped) continue
    if (j in newval) printf "%s%s: %s\n", spaces(indent[j]), key[j], newval[j]
    else printf "%s\n", raw[j]
    if (j in insert_after) printf "%s", insert_after[j]
  }
  printf "%s", eof_insert
}
AWK
)

yaml_get() { # file dotted.key
	local file="$1" key="$2"
	[[ -r $file ]] || return 1
	awk -v target="$key" "$AWK_YAML_GET" "$file" 2>/dev/null || true
}

yaml_list() { # file dotted.key -> one item per line
	local file="$1" key="$2"
	[[ -r $file ]] || return 1
	awk -v target="$key" "$AWK_YAML_LIST" "$file" 2>/dev/null || true
}

# With the Headscale directory mounted at the SAME absolute path in both
# containers, a container path IS the host path.  Anything else cannot be
# resolved back to a file on this machine and fails here.
container_to_host_path() {
	local p="$1"
	case "$p" in
	"$HS_DIR" | "$HS_DIR"/*) printf '%s' "$p" ;;
	*) return 1 ;;
	esac
}

# Headscale refuses to start when a derp.paths entry names a file it cannot read,
# so an install that leaves one behind looks successful and then crashes.  Every
# entry of the written config is resolved back to its path on this machine here;
# anything missing stops a real run before the containers are started (a dry run
# only reports what it sees, because migration and the placeholder still run).
verify_derp_paths() { # <written or previewed yaml> <real|plan>
	local file="$1" phase="${2:-real}" entry host base bad=0 listed=0 ok=0
	while IFS= read -r entry; do
		[[ -n $entry ]] || continue
		listed=1
		if ! host="$(container_to_host_path "$entry")"; then
			warn "derp.paths entry $entry is outside $HS_DIR; the Headscale container cannot read it (only $HS_DIR is mounted)"
			bad=$((bad + 1))
			continue
		fi
		base="${entry##*/}"
		ok=0
		[[ -e $host ]] && ok=1
		[[ $entry == "$DERP_MAP_CTR" && $host == "$DERP_MAP_HOST" ]] && ok=1
		[[ -n $MIGRATE_SRC && -e "$MIGRATE_SRC/derp-maps/$base" ]] && ok=1
		if ((ok == 1)); then
			dim "  derp.paths ok: $entry"
			continue
		fi
		warn "derp.paths entry $entry has no file behind it ($host)"
		bad=$((bad + 1))
	done < <(yaml_list "$file" "derp.paths" || true)
	((listed)) || return 0
	((bad == 0)) && return 0
	if [[ $phase == "real" ]]; then
		die "$bad derp.paths entry/entries would stop Headscale at start-up; put each map in $DERP_MAP_DIR (the directory mounted at the same absolute path in both containers) or drop the line, then re-run"
	fi
	warn "$bad derp.paths entry/entries of the planned config would stop Headscale at start-up"
	return 0
}

patch_config() { # src spec logfile  (patched YAML on stdout)
	local src="$1" spec="$2" log="$3"
	awk -v specfile="$spec" -v logfile="$log" -v hs_dir="$HS_DIR" "$AWK_PATCH" "$src"
}

# -----------------------------------------------------------------------------
# Ports
# -----------------------------------------------------------------------------
listening_sockets() {
	if have ss; then
		ss -lntu 2>/dev/null && return 0
	fi
	if have netstat; then
		netstat -lntu 2>/dev/null && return 0
	fi
	return 1
}

warn_port_conflict() { # port proto label
	local port="$1" proto="$2" label="$3" out=""
	if ! out="$(listening_sockets)"; then
		dim "  (port check skipped: neither 'ss' nor 'netstat' could list sockets)"
		return 0
	fi
	if printf '%s\n' "$out" | grep -Eq "[:.]$port([[:space:]]|$)"; then
		warn "$label: something is already listening on $proto/$port (the native Headscale may still be running; stop it before 'docker compose up -d')"
	else
		ok "  $label: $proto/$port looks free"
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Actions.  Every write goes through one of these, so --dry-run can never
# change anything outside the private temporary directory.
# -----------------------------------------------------------------------------
act_mkdir() {
	local d="$1" mode="${2:-755}"
	if ((DRY_RUN)); then
		emit "  [dry-run] mkdir -p -m $mode $d"
		return 0
	fi
	if [[ -d $d ]]; then
		dim "  exists: $d"
	else
		mkdir -p "$d"
		chmod "$mode" "$d" 2>/dev/null || true
		ok "  created: $d"
	fi
	return 0
}

act_backup_file() { # path
	local f="$1" ts="$2" b
	b="$f.bak-$ts"
	if ((DRY_RUN)); then
		[[ -e $f ]] && emit "  [dry-run] cp -a $f $b"
		return 0
	fi
	if [[ -e $f ]]; then
		cp -a "$f" "$b"
		BACKUP_FILES+=("$b")
		ok "  backed up: $f -> $b"
	fi
	return 0
}

act_copy() { # src dst [mode] [label]
	local src="$1" dst="$2" mode="${3:-}" label="${4:-}"
	if [[ ! -e $src ]]; then
		warn "missing source, skipped: $src"
		return 0
	fi
	if ((DRY_RUN)); then
		[[ -e $dst ]] && emit "  [dry-run] cp -a $dst $dst.bak-$RUN_STAMP (existing destination kept)"
		emit "  [dry-run] cp -a $src $dst${mode:+ && chmod $mode $dst}"
		COPIED_FILES+=("$src -> $dst")
		return 0
	fi
	if [[ -e $dst ]]; then
		act_backup_file "$dst" "$RUN_STAMP"
	fi
	mkdir -p "$(dirname "$dst")"
	cp -a "$src" "$dst"
	if [[ -n $mode ]]; then
		chmod "$mode" "$dst" 2>/dev/null || warn "could not chmod $mode $dst"
	fi
	COPIED_FILES+=("$src -> $dst")
	local extra=""
	if have sha256sum; then
		extra=" sha256=$(sha256sum "$src" | awk '{print $1}')"
	fi
	ok "  copied: $src -> $dst (${label:-file})$extra"
	return 0
}

# stage_file <final path> <mode> <content on stdin>
stage_file() {
	local final="$1" mode="${2:-644}" staged content_file
	content_file="$(new_tmp_file)"
	cat >"$content_file"
	if ((DRY_RUN)); then
		if [[ -z $STAGE_DIR ]]; then
			STAGE_DIR="$(mktemp -d "$TMP_ROOT/stage.XXXXXX")"
			TMP_DIRS+=("$STAGE_DIR")
		fi
		staged="$STAGE_DIR/$(printf '%s' "$final" | tr '/' '_')"
		cp "$content_file" "$staged"
		WRITTEN_FILES+=("$final (mode $mode)")
		emit ""
		emit "--- would write: $final (mode $mode) ---"
		mask_config_lines <"$content_file"
		emit "--- end: $final ---"
		return 0
	fi
	local dir tmp
	dir="$(dirname "$final")"
	mkdir -p "$dir"
	tmp="$(mktemp "$dir/.$(basename "$final").tmp.XXXXXX")"
	TMP_FILES+=("$tmp")
	chmod "$mode" "$tmp" 2>/dev/null || true
	cat "$content_file" >"$tmp"
	mv -f "$tmp" "$final"
	chmod "$mode" "$final" 2>/dev/null || warn "could not chmod $mode $final"
	WRITTEN_FILES+=("$final (mode $mode)")
	ok "  wrote: $final (mode $mode)"
	return 0
}

# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------
preflight() {
	head2 "Preflight"
	if [[ $(id -u) -eq 0 ]]; then
		ROOT_UID=1
		ok "running as root"
	else
		warn "not running as root: file ownership cannot be fixed for the containers (run with sudo if you hit permission errors)"
	fi
	local missing=()
	if ! have docker; then
		missing+=("docker (the Docker CLI is not in PATH)")
	else
		if docker compose version >/dev/null 2>&1; then
			ok "docker + docker compose plugin found"
		else
			missing+=("the 'docker compose' plugin (docker: $(docker --version 2>/dev/null || echo unknown))")
		fi
	fi
	if ((${#missing[@]} > 0)); then
		if ((DRY_RUN)); then
			warn "missing: ${missing[*]}"
			warn "continuing because --dry-run changes nothing; a real run would stop here"
		else
			local m
			err "this installer needs the following and will not continue:"
			for m in "${missing[@]}"; do
				err "  - $m"
			done
			err "install Docker + the Compose plugin, or re-run with --dry-run to see the plan only"
			exit 1
		fi
	fi
	if have openssl; then HAVE_OPENSSL=1; fi
	if have curl; then HAVE_CURL=1; fi
	if [[ -r /etc/timezone ]]; then
		TZONE="$(trim "$(head -n 1 /etc/timezone 2>/dev/null || true)")"
	elif [[ -L /etc/localtime ]]; then
		local link
		link="$(readlink /etc/localtime 2>/dev/null || true)"
		if [[ $link == *zoneinfo/* ]]; then
			TZONE="${link##*zoneinfo/}"
		fi
	fi
	if [[ -z $TZONE ]]; then
		TZONE="$DEFAULT_TZ_FALLBACK"
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Step 1: base directory
# -----------------------------------------------------------------------------
step_base_dir() {
	head2 "Step 1/9  Deployment directory"
	local candidate="$DEFAULT_BASE_DIR"
	if [[ -n ${OPT_BASE_DIR:-} ]]; then
		candidate="$OPT_BASE_DIR"
	elif [[ -f ./docker-compose.yml || -f ./config.yaml ]]; then
		candidate="$(pwd)"
		dim "an existing config.yaml / docker-compose.yml was found here, using this directory as the default"
	fi

	local tries=0 reply depth probe
	while :; do
		if [[ -n ${OPT_BASE_DIR:-} && $tries -eq 0 ]]; then
			reply="$OPT_BASE_DIR"
			printf 'Deployment directory [%s]: %s (--base-dir)\n' "$candidate" "$reply" >&2
		else
			read_input reply "Deployment directory (docker-compose.yml, .env, config.yaml, data/ and headscale/ live here)" "$candidate"
		fi
		if ! v_abs_path "$reply"; then
			tries=$((tries + 1))
			((tries >= 5)) && die "too many invalid answers for the deployment directory"
			continue
		fi
		reply="$(norm_path "$reply")"
		case "$reply" in
		/ | /etc | /usr | /bin | /sbin | /boot | /var | /root | /tmp)
			warn "'$reply' looks like a system directory; pick a dedicated folder such as $DEFAULT_BASE_DIR"
			tries=$((tries + 1))
			((tries >= 5)) && die "too many invalid answers for the deployment directory"
			continue
			;;
		esac
		# Writability, without touching the disk: only the deepest existing
		# ancestor is probed.  Creating the directory and writing a probe file
		# here contradicted the promise printed in MODE above (files are written
		# once the plan is confirmed); the real mkdir -p runs in the write phase,
		# which reports any remaining failure there.
		if [[ -e $reply && ! -d $reply ]]; then
			warn "'$reply' exists and is not a directory; choose another path"
			tries=$((tries + 1))
			((tries >= 5)) && die "too many invalid answers for the deployment directory"
			continue
		fi
		probe="$(path_deepest_existing "$reply")"
		if [[ ! -w $probe ]]; then
			warn "'$probe' is not writable by $(id -un); choose another path or re-run with sudo"
			tries=$((tries + 1))
			((tries >= 5)) && die "too many invalid answers for the deployment directory"
			continue
		fi
		BASE_DIR="$reply"
		break
	done

	# ---------------------------------------------------------------------
	# One nested directory holds everything, exactly like the deployment in
	# docs/install/dual-image.md.  The Headscale directory is mounted at the
	# SAME absolute path inside both containers, so the absolute paths inside
	# its config.yaml keep working unchanged - nothing is rewritten to
	# /etc/headscale or /var/lib/headscale.  The four defaults below are
	# derived from the deployment directory; press Enter to accept them.
	# ---------------------------------------------------------------------
	BASE_DIR="$(norm_path "$BASE_DIR")"
	say ""
	say "The four paths below are the host side of the volume entries. The Headscale"
	say "directory is mounted at the same absolute path in both containers; only its"
	say "config.yaml is additionally mounted at /etc/headscale/config.yaml."
	ask HP_CONFIG "HeadplaneCN config file (mode 600; an existing file is patched, never replaced)" "$BASE_DIR/config.yaml" v_host_file
	HP_CONFIG="$(norm_path "$HP_CONFIG")"
	ask HP_DATA "HeadplaneCN data directory (sessions, internal database, snapshots)" "$BASE_DIR/data" v_host_dir
	HP_DATA="$(norm_path "$HP_DATA")"
	ask HS_DIR "Headscale directory (config.yaml, db.sqlite, the private keys, cache/ and derp-maps/)" "$BASE_DIR/headscale" v_host_dir
	HS_DIR="$(norm_path "$HS_DIR")"
	HS_CONFIG="$HS_DIR/config.yaml"
	ask DERP_MAP_DIR "DERP map directory inside the Headscale directory (holds $DEFAULT_DERP_MAP_NAME)" "$HS_DIR/$DEFAULT_DERP_DIR_NAME" v_derp_dir
	DERP_MAP_DIR="$(norm_path "$DERP_MAP_DIR")"

	DERP_MAP_HOST="$DERP_MAP_DIR/$DEFAULT_DERP_MAP_NAME"
	DERP_MAP_CTR="$DERP_MAP_HOST"

	# Caddy does the /admin path split in front of the panel, so its Caddyfile
	# lives in the same deployment directory as the panel's config.  Only the
	# Lucky layout needs the service; the port / two-domain layouts delete it.
	CADDY_DIR="$BASE_DIR/caddy"
	CADDY_FILE="$CADDY_DIR/Caddyfile"
	# One prefix builds all three image references.  A user who already typed the
	# mirror into --headscale-tag / --headplane-tag keeps working: the compose
	# writer strips the prefix back off the repository.
	if [[ -n ${OPT_IMAGE_PROXY:-} ]]; then
		v_image_proxy "$OPT_IMAGE_PROXY" || die "invalid --image-proxy: $OPT_IMAGE_PROXY"
		IMAGE_PROXY="$(normalize_image_proxy "$OPT_IMAGE_PROXY")"
	else
		IMAGE_PROXY="$DEFAULT_IMAGE_PROXY"
	fi
	if [[ -n ${OPT_CADDY_PORT:-} ]]; then
		v_port "$OPT_CADDY_PORT" || die "invalid --caddy-port: $OPT_CADDY_PORT"
		CADDY_PORT="$OPT_CADDY_PORT"
	else
		CADDY_PORT="$DEFAULT_CADDY_PORT"
	fi
	v_container_path "$DERP_MAP_CTR" ||
		die "internal error: the derived DERP map path is not below $HS_DIR: $DERP_MAP_CTR"
	ENV_FILE="$BASE_DIR/.env"
	BACKUP_DIR="$BASE_DIR/backup"
	COMPOSE_FILE="$BASE_DIR/docker-compose.yml"
	warn_layout_collisions
	# The recursive chown of the Headscale directory happens later, so a layout
	# that would hand it unrelated files is rejected here, before anything exists.
	v_recursive_chown_target "$HS_DIR" || die "refusing to change the ownership of $HS_DIR recursively"
	ok "deployment directory: $BASE_DIR"
	confirm "These directories will hold the Headscale database and private keys (back them up regularly). Understood?" y ||
		die "aborted by the operator"
	dim "  the resolved layout is printed again in the plan, before anything is written"
	return 0
}

# -----------------------------------------------------------------------------
# Step 2: images
# -----------------------------------------------------------------------------
step_images() {
	head2 "Step 2/9  Container images to pin"
	if [[ -n ${OPT_HS_IMAGE:-} ]]; then
		v_image_ref "$OPT_HS_IMAGE" || die "invalid --headscale-tag: $OPT_HS_IMAGE"
		HS_IMAGE="$OPT_HS_IMAGE"
		printf 'Headscale image [%s]: %s (--headscale-tag)\n' "$DEFAULT_HS_IMAGE" "$HS_IMAGE" >&2
	else
		ask HS_IMAGE "Headscale image (repo:tag, pinned)" "$DEFAULT_HS_IMAGE" v_image_ref
	fi
	if [[ -n ${OPT_HP_IMAGE:-} ]]; then
		v_image_ref "$OPT_HP_IMAGE" || die "invalid --headplane-tag: $OPT_HP_IMAGE"
		HP_IMAGE="$OPT_HP_IMAGE"
		printf 'HeadplaneCN image [%s]: %s (--headplane-tag)\n' "$DEFAULT_HP_IMAGE" "$HP_IMAGE" >&2
	else
		ask HP_IMAGE "HeadplaneCN image (repo:tag, pinned)" "$DEFAULT_HP_IMAGE" v_image_ref
	fi
	# The compose file and .env only carry these two keys (HEADSCALE_VERSION and
	# HEADPLANE_VERSION), so the tag is split off here: one edit in .env moves
	# the whole stack.
	HS_IMAGE_REPO="${HS_IMAGE%:*}"
	HS_IMAGE_VERSION="${HS_IMAGE##*:}"
	HP_IMAGE_REPO="${HP_IMAGE%:*}"
	HP_IMAGE_VERSION="${HP_IMAGE##*:}"
	dim "  these two tags are the version lock; upgrading means editing them in $ENV_FILE"
	return 0
}

# -----------------------------------------------------------------------------
# Step 3: URLs
# -----------------------------------------------------------------------------
split_url() { # url -> sets url_scheme url_host url_port
	local url="$1" rest="${1#*://}"
	url_scheme="${url%%://*}"
	rest="${url#*://}"
	url_host="$rest"
	url_port=""
	if [[ $rest == *:* ]]; then
		url_host="${rest%:*}"
		url_port="${rest##*:}"
	fi
	[[ -n $url_port ]] || {
		if [[ $url_scheme == https ]]; then url_port=443; else url_port=80; fi
	}
	return 0
}

step_urls() {
	head2 "Step 3/9  Client URL, DERP and admin UI"
	local existing_url="" d
	existing_url="$(yaml_get "$HS_CONFIG" "server_url" 2>/dev/null || true)"
	[[ -n $existing_url ]] || existing_url="$(yaml_get "$HP_CONFIG" "headscale.public_url" 2>/dev/null || true)"
	local url_default="$DEFAULT_SERVER_URL"
	[[ -n $existing_url ]] && url_default="$existing_url"

	if [[ -n ${OPT_SERVER_URL:-} ]]; then
		v_http_url "$OPT_SERVER_URL" || die "invalid --server-url: $OPT_SERVER_URL"
		SERVER_URL="$OPT_SERVER_URL"
		printf 'Client server_url [%s]: %s (--server-url)\n' "$url_default" "$SERVER_URL" >&2
	else
		say "This is the address clients register against (Headscale's server_url)."
		say "If you are migrating, it MUST stay byte-for-byte identical to the current value."
		ask SERVER_URL "Client server_url (scheme://host[:port])" "$url_default" v_http_url
	fi
	split_url "$SERVER_URL"
	CLIENT_SCHEME="$url_scheme"
	CLIENT_HOST="$url_host"
	CLIENT_PORT="$url_port"

	if [[ -n ${OPT_DERP_HOST:-} ]]; then
		v_host_port_opt "$OPT_DERP_HOST" || die "invalid --derp-host: $OPT_DERP_HOST"
		DERP_HOST="$OPT_DERP_HOST"
		printf 'Embedded DERP host[:port] [none]: %s (--derp-host)\n' "$DERP_HOST" >&2
	else
		say ""
		say "Optional: a second public hostname that also serves /derp (answer 'none' if the"
		say "client hostname above is enough - it always has to serve /derp anyway)."
		ask DERP_HOST "Embedded DERP host[:port], or none" "none" v_host_port_opt
	fi
	if [[ $DERP_HOST == "none" || $DERP_HOST == "direct" || -z $DERP_HOST ]]; then
		DERP_URL="$SERVER_URL"
		DERP_HOST="none"
	else
		local dh="${DERP_HOST%:*}" dp="${DERP_HOST##*:}"
		[[ $DERP_HOST == *:* ]] || dp="$CLIENT_PORT"
		DERP_URL="$CLIENT_SCHEME://$dh:$dp"
	fi

	if [[ -n ${OPT_ADMIN_HOST:-} ]]; then
		v_host_port_opt "$OPT_ADMIN_HOST" || die "invalid --admin-host: $OPT_ADMIN_HOST"
		ADMIN_HOST="$OPT_ADMIN_HOST"
		printf 'Admin UI host[:port] [none]: %s (--admin-host)\n' "$ADMIN_HOST" >&2
	else
		say ""
		say "Optional: a separate hostname for the HeadplaneCN admin UI. Answer 'none' to reuse"
		say "the client URL (the UI is then at <client url>/admin)."
		ask ADMIN_HOST "Admin UI host[:port], or none" "none" v_host_port_opt
	fi
	if [[ $ADMIN_HOST == "none" || $ADMIN_HOST == "direct" || -z $ADMIN_HOST ]]; then
		ADMIN_URL="$SERVER_URL"
		ADMIN_HOST="none"
	else
		local ah="${ADMIN_HOST%:*}" ap="${ADMIN_HOST##*:}"
		[[ $ADMIN_HOST == *:* ]] || ap="$CLIENT_PORT"
		ADMIN_URL="$CLIENT_SCHEME://$ah:$ap"
	fi
	# server.base_url must NOT include /admin (the dashboard prefix is appended by the UI)
	BASE_URL="$ADMIN_URL"
	if [[ $ADMIN_HOST == "none" ]]; then
		dim "  server.base_url defaults to the client URL; the UI is at $BASE_URL/admin"
	else
		dim "  server.base_url = admin URL; the UI is at $BASE_URL/admin"
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Step 4: networking, ports, timezone
# -----------------------------------------------------------------------------
step_network() {
	head2 "Step 4/9  Networking, ports and timezone"
	say "Both containers use network_mode: host, exactly like the deployment verified in"
	say "docs/install/dual-image.md: no ports: section is written, the containers bind the"
	say "ports below directly on this machine, and 127.0.0.1 inside a container is this machine."

	# HeadplaneCN listen port
	local panel_default="$DEFAULT_ADMIN_PORT"
	local panel_existing=""
	panel_existing="$(yaml_get "$HP_CONFIG" "server.port" 2>/dev/null || true)"
	[[ -n $panel_existing ]] && panel_default="$panel_existing"
	if [[ -n ${OPT_HP_PORT:-} ]]; then
		v_port "$OPT_HP_PORT" || die "invalid --admin-port: $OPT_HP_PORT"
		PANEL_PORT="$OPT_HP_PORT"
		printf 'HeadplaneCN listen port [%s]: %s (--admin-port)\n' "$panel_default" "$PANEL_PORT" >&2
	else
		ask PANEL_PORT "HeadplaneCN listen port (the reverse proxy points at this)" "$panel_default" v_port
	fi
	if [[ $PANEL_PORT == "$DEFAULT_HS_PORT" || $PANEL_PORT == "$DEFAULT_METRICS_PORT" ]]; then
		warn "$PANEL_PORT is already used by Headscale ($DEFAULT_HS_PORT control / $DEFAULT_METRICS_PORT metrics)"
		ask PANEL_PORT "HeadplaneCN listen port (must differ from $DEFAULT_HS_PORT and $DEFAULT_METRICS_PORT)" "$DEFAULT_ADMIN_PORT" v_port
	fi

	# The panel binds the host address directly (network_mode: host), so this
	# choice decides who can reach the dashboard at all.  The default is this
	# machine's LAN address: reachable from the LAN, not from the internet.
	local bind_default="192.168.1.10" bind_existing=""
	bind_existing="$(yaml_get "$HP_CONFIG" "server.host" 2>/dev/null || true)"
	if v_bind_addr "$bind_existing" 2>/dev/null; then
		bind_default="$bind_existing"
	fi
	if [[ -n ${OPT_ADMIN_BIND:-} ]]; then
		v_bind_addr "$OPT_ADMIN_BIND" || die "invalid --admin-bind: $OPT_ADMIN_BIND (use 0.0.0.0, 127.0.0.1 or an IPv4 address)"
		PANEL_BIND="$OPT_ADMIN_BIND"
		printf 'Panel bind address [%s]: %s (--admin-bind)\n' "$bind_default" "$PANEL_BIND" >&2
	else
		local ab=""
		choose_index ab "HeadplaneCN listen address:" 1 \
			"$bind_default  (this machine's LAN address - the recommended default)" \
			"0.0.0.0  (all interfaces - reachable from the whole LAN)" \
			"127.0.0.1  (local only - put the reverse proxy on this machine)"
		case "$ab" in
		2) PANEL_BIND="0.0.0.0" ;;
		3) PANEL_BIND="127.0.0.1" ;;
		*) ask PANEL_BIND "Panel bind address (0.0.0.0, 127.0.0.1 or an IPv4 address)" "$bind_default" v_bind_addr ;;
		esac
	fi
	if [[ $PANEL_BIND == "127.0.0.1" ]]; then
		dim "  the panel is only reachable on 127.0.0.1:$PANEL_PORT of this machine"
	elif [[ $PANEL_BIND == "0.0.0.0" ]]; then
		warn "the panel is reachable on every interface of this machine (tcp/$PANEL_PORT); firewall it or put a TLS reverse proxy in front of it"
	else
		dim "  the panel listens on $PANEL_BIND:$PANEL_PORT"
	fi

	# STUN
	if [[ -n ${OPT_STUN_PORT:-} ]]; then
		v_port "$OPT_STUN_PORT" || die "invalid --stun-port: $OPT_STUN_PORT"
		STUN_PORT="$OPT_STUN_PORT"
		printf 'STUN udp port [%s]: %s (--stun-port)\n' "$DEFAULT_STUN_PORT" "$STUN_PORT" >&2
	else
		ask STUN_PORT "STUN udp port announced by the embedded DERP" "$DEFAULT_STUN_PORT" v_port
	fi

	# metrics: Headscale's own listener, localhost-only unless asked otherwise
	local mi=""
	choose_index mi "Headscale metrics listen address:" 1 \
		"127.0.0.1:$DEFAULT_METRICS_PORT  (local only - recommended)" \
		"0.0.0.0:$DEFAULT_METRICS_PORT  (all interfaces - only if you restrict it yourself)"
	if [[ $mi == "2" ]]; then
		METRICS_ADDR="0.0.0.0:$DEFAULT_METRICS_PORT"
		warn "metrics will be reachable from the whole LAN; do not expose $DEFAULT_METRICS_PORT to the internet"
	else
		METRICS_ADDR="127.0.0.1:$DEFAULT_METRICS_PORT"
	fi

	# timezone
	if [[ -n ${OPT_TZ:-} ]]; then
		v_tz "$OPT_TZ" || die "invalid --tz: $OPT_TZ"
		TZONE="$OPT_TZ"
		printf 'Timezone [%s]: %s (--tz)\n' "$TZONE" "$TZONE" >&2
	else
		ask TZONE "Timezone for both containers" "$TZONE" v_tz
	fi

	# port conflicts (warn only)
	say ""
	say "Checking whether these ports are already in use:"
	warn_port_conflict "$DEFAULT_HS_PORT" "tcp" "Headscale control"
	warn_port_conflict "${METRICS_ADDR##*:}" "tcp" "Headscale metrics"
	warn_port_conflict "$STUN_PORT" "udp" "embedded DERP STUN"
	warn_port_conflict "$PANEL_PORT" "tcp" "HeadplaneCN"

	if [[ $CLIENT_PORT == "$DEFAULT_HS_PORT" || $CLIENT_PORT == "$PANEL_PORT" || $CLIENT_PORT == "$DEFAULT_METRICS_PORT" ]]; then
		warn "the public client port $CLIENT_PORT is also used by a local listener; that is fine only if the reverse proxy runs on another machine"
	fi
	if [[ $STUN_PORT == "$DEFAULT_HS_PORT" || $STUN_PORT == "$PANEL_PORT" || $STUN_PORT == "$DEFAULT_METRICS_PORT" ]]; then
		warn "the STUN port $STUN_PORT equals a TCP listener port; UDP and TCP can coexist, but double-check your proxy"
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Step 5: secrets
# -----------------------------------------------------------------------------
generate_cookie_secret() {
	local s=""
	if ((HAVE_OPENSSL)); then
		s="$(openssl rand -base64 24 2>/dev/null | tr -d '\n' | cut -c1-32)"
	elif [[ -r /dev/urandom ]]; then
		s="$(head -c 24 /dev/urandom | base64 | tr -d '\n' | cut -c1-32)"
	fi
	if ((${#s} != 32)); then
		die "could not generate a 32 character secret (openssl missing and /dev/urandom unreadable); create one with: openssl rand -base64 24"
	fi
	printf '%s' "$s"
}

step_secrets() {
	head2 "Step 5/9  Secrets (API key and cookie secret)"
	say "A Headscale API key is required for the config check, config saves and the HeadplaneCN agent."
	say "It is only shown once when created:  docker compose exec headscale headscale apikeys create"
	local choice="" key="" kf=""
	choose_index choice "Headscale API key:" 2 \
		"Use an existing API key (paste it now, input hidden)" \
		"Leave it blank for now (an instruction is printed and written into the config)" \
		"Read the key from a file (for example /root/hskey.txt)"
	case "$choice" in
	1)
		read_secret key "Paste the Headscale API key"
		if ! v_nonempty "$key"; then
			die "empty API key; re-run and choose option 2 to leave it blank"
		fi
		[[ $key == hskey-* ]] || warn "this does not look like a Headscale API key (they start with 'hskey-')"
		API_KEY="$key"
		API_KEY_STATE="set"
		ok "  API key accepted: $(mask_secret "$API_KEY")"
		;;
	3)
		read_input kf "Path to the file containing the API key" "" 
		v_abs_path "$kf" || die "invalid path: $kf"
		[[ -r $kf ]] || die "cannot read $kf"
		API_KEY="$(trim "$(head -n 1 "$kf")")"
		v_nonempty "$API_KEY" || die "$kf is empty"
		reject_special "$API_KEY" "API key" || die "the key in $kf contains unsupported characters"
		API_KEY_STATE="set"
		ok "  API key read from $kf: $(mask_secret "$API_KEY")"
		;;
	*)
		API_KEY=""
		API_KEY_STATE="blank"
		API_KEY_NEEDED_HINT=1
		warn "no API key: login, the config check and the agent stay disabled until you add one"
		say "  create one later with:"
		say "    cd $BASE_DIR && docker compose exec headscale headscale apikeys create"
		say "  then put the full key into headscale.api_key in $HP_CONFIG"
		;;
	esac

	say ""
	local existing_cookie=""
	existing_cookie="$(yaml_get "$HP_CONFIG" "server.cookie_secret" 2>/dev/null || true)"
	KEEP_COOKIE=0
	if [[ -n $existing_cookie && $existing_cookie != *"change_me"* ]]; then
		if confirm "An existing cookie_secret was found in $HP_CONFIG - keep it (keeps current sessions valid)?" y; then
			KEEP_COOKIE=1
			COOKIE_SECRET="$existing_cookie"
			COOKIE_STATE="existing value kept ($(mask_secret "$COOKIE_SECRET"))"
			ok "  keeping the existing cookie_secret: $(mask_secret "$COOKIE_SECRET")"
		fi
	fi
	if ((KEEP_COOKIE == 0)); then
		if confirm "Generate a random 32 character cookie_secret now?" y; then
			COOKIE_SECRET="$(generate_cookie_secret)"
			COOKIE_STATE="generated ($(mask_secret "$COOKIE_SECRET"))"
			ok "  generated cookie_secret: $(mask_secret "$COOKIE_SECRET")"
			dim "  the real value is written to $HP_CONFIG (mode 600); rotate it by re-running this installer"
		else
			read_secret COOKIE_SECRET "Paste the existing cookie_secret (exactly 32 characters)"
			v_secret32 "$COOKIE_SECRET" || die "the cookie_secret must be exactly 32 characters"
			COOKIE_STATE="provided by the operator ($(mask_secret "$COOKIE_SECRET"))"
			ok "  cookie_secret accepted: $(mask_secret "$COOKIE_SECRET")"
		fi
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Step 6: DERP map file and region
# -----------------------------------------------------------------------------
step_derp() {
	head2 "Step 6/9  Embedded DERP"
	if [[ -n ${OPT_REGION_ID:-} ]]; then
		v_region_id "$OPT_REGION_ID" || die "invalid --region-id: $OPT_REGION_ID"
		REGION_ID="$OPT_REGION_ID"
		printf 'DERP region id [%s]: %s (--region-id)\n' "$DEFAULT_REGION_ID" "$REGION_ID" >&2
	else
		ask REGION_ID "DERP region id" "$DEFAULT_REGION_ID" v_region_id
	fi
	ask REGION_CODE "DERP region code" "$DEFAULT_REGION_CODE" v_nonempty
	ask REGION_NAME "DERP region name" "$DEFAULT_REGION_NAME" v_nonempty
	# The DERP map directory was chosen in step 1 and sits inside the Headscale
	# directory, so its container path is the same absolute path.
	ok "  the map file lives on the host at $DERP_MAP_HOST"
	dim "  DERP map directory: $DERP_MAP_DIR -> the SAME absolute path in both containers (rw)"
	return 0
}

# -----------------------------------------------------------------------------
# Step 7: migration plan
# -----------------------------------------------------------------------------
step_migration() {
	head2 "Step 7/9  Migrate an existing Headscale installation (optional)"
	if [[ -f $HS_CONFIG ]]; then
		dim "  $HS_CONFIG already exists; the installer will adopt and patch it instead of copying"
	fi
	if ! confirm "Copy an existing Headscale directory (for example /vol1/@appdata/headscale) into $HS_DIR?" n; then
		MIGRATE_ACTIVE=0
		return 0
	fi
	local src reply
	read_input reply "Existing Headscale directory" "/vol1/@appdata/headscale"
	v_abs_path "$reply" || die "invalid path: $reply"
	src="$(norm_path "$reply")"
	[[ -d $src ]] || die "not a directory: $src"
	# the source must be outside every directory this run writes into
	local target
	for target in "$BASE_DIR" "$HS_DIR" "$HP_DATA" "$BACKUP_DIR"; do
		case "$src" in
		"$target" | "$target"/*) die "the source must not be inside the target directory ($target)" ;;
		esac
		case "$target" in
		"$src" | "$src"/*) die "the target directory $target must not be inside the source ($src)" ;;
		esac
	done
	local found=0 f
	for f in config.yaml db.sqlite noise_private.key; do
		[[ -e "$src/$f" ]] && found=1
	done
	((found == 1)) || die "$src does not look like a Headscale directory (no config.yaml, db.sqlite or noise_private.key)"
	MIGRATE_SRC="$src"
	MIGRATE_ACTIVE=1
	say ""
	say "The originals in $src are only ever READ: nothing there is deleted, moved or modified."
	say "The whole directory is copied into $HS_DIR, which both containers mount at the SAME absolute"
	say "path, so the absolute paths inside config.yaml keep working unchanged."
	local entry n=0
	for entry in config.yaml db.sqlite noise_private.key private.key derp_server_private.key policy.hujson derp-maps cache; do
		if [[ -e "$src/$entry" ]]; then
			say "  found: $src/$entry"
		fi
	done
	for entry in "$src"/*; do
		[[ -e $entry ]] || continue
		case "$(basename "$entry")" in
		config.yaml | db.sqlite | noise_private.key | private.key | derp_server_private.key | policy.hujson | derp-maps | cache) ;;
		*)
			say "  also copied as-is: $entry"
			n=$((n + 1))
			;;
		esac
	done
	((n == 0)) && dim "  (nothing else in that directory)"
	dim "  headscale.log, headscale.pid and headscale.sock are dropped from the COPY: runtime leftovers."
	return 0
}

plan_migration() {
	local ts="${1:-$RUN_STAMP}" archive
	archive="$BACKUP_DIR/native-headscale-$ts.tar.gz"
	emit "  migration source : $MIGRATE_SRC   (read-only; nothing is moved or deleted there)"
	emit "  backup           : tar -czf $archive -C $(dirname "$MIGRATE_SRC") $(basename "$MIGRATE_SRC")   (mode 600)"
	emit "  copy             : cp -a $MIGRATE_SRC/. $HS_DIR/   (config.yaml, db.sqlite and every key)"
	emit "  drop from copy   : headscale.log, headscale.pid, headscale.sock"
	emit "  config.yaml      : absolute paths are left untouched (the directory keeps its path)"
	return 0
}

run_migration() {
	local ts="${1:-$RUN_STAMP}" archive entry
	archive="$BACKUP_DIR/native-headscale-$ts.tar.gz"
	emit ""
	emit "--- migration from $MIGRATE_SRC ---"
	if ((DRY_RUN)); then
		plan_migration "$ts"
		return 0
	fi
	if have tar; then
		# the archive holds the database and the private keys, so create it
		# owner-only instead of trusting the umask of whoever runs the script
		if (umask 077 && tar -czf "$archive" -C "$(dirname "$MIGRATE_SRC")" "$(basename "$MIGRATE_SRC")"); then
			chmod 0600 "$archive" 2>/dev/null || warn "  could not restrict permissions on $archive, which holds the private keys"
			BACKUP_FILES+=("$archive")
			ok "  backup written: $archive ($(wc -c <"$archive" | tr -d ' ') bytes)"
			if have sha256sum; then
				dim "  sha256: $(sha256sum "$archive" | awk '{print $1}')"
			fi
		else
			die "the backup failed; nothing was copied (your original data is untouched)"
		fi
	else
		die "tar is missing; refusing to migrate without a backup (your original data is untouched)"
	fi
	# Copy the whole directory. The container mounts it at the SAME absolute
	# path, so the absolute paths inside config.yaml keep working unchanged.
	act_mkdir "$HS_DIR" 755
	if (cp -a "$MIGRATE_SRC/." "$HS_DIR/"); then
		COPIED_FILES+=("$MIGRATE_SRC/* -> $HS_DIR/")
		ok "  copied: $MIGRATE_SRC/* -> $HS_DIR/"
	else
		die "the copy failed; your original data in $MIGRATE_SRC is untouched"
	fi
	for entry in headscale.log headscale.pid headscale.sock; do
		if [[ -e "$HS_DIR/$entry" ]]; then
			rm -f "$HS_DIR/$entry"
			dim "  dropped the runtime leftover $HS_DIR/$entry from the copy"
		fi
	done
	for entry in noise_private.key private.key derp_server_private.key; do
		if [[ -e "$HS_DIR/$entry" ]]; then
			chmod 600 "$HS_DIR/$entry" 2>/dev/null || warn "  could not chmod 600 $HS_DIR/$entry"
		fi
	done
	dim "  container user: ${HEADSCALE_UID:-0}:${HEADSCALE_GID:-0} (HEADSCALE_UID / HEADSCALE_GID in .env)."
	dim "  If the copies of db.sqlite and the keys belong to another user, run 'ls -ln $HS_DIR | head'"
	dim "  and put those two numbers into HEADSCALE_UID and HEADSCALE_GID in $ENV_FILE."
	return 0
}

# -----------------------------------------------------------------------------
# Configuration generation
# -----------------------------------------------------------------------------
hs_config_skeleton() {
	cat <<EOF
# Headscale configuration
# Generated by $SCRIPT_NAME v$SCRIPT_VERSION on $RUN_TS
# Deployment shape: docs/install/dual-image.md (Headscale and HeadplaneCN in
# separate containers, host networking, the Headscale directory mounted at the
# SAME absolute path in both of them).
#
# Every path below points into $HS_DIR, which exists on the host and inside
# both containers at that identical absolute path. Nothing has to be rewritten
# to /etc/headscale or /var/lib/headscale because of that.
#
# MOST IMPORTANT: server_url is the address your clients registered against.
# Keep it byte-for-byte identical - changing it forces every node to log in
# again.

server_url: "$SERVER_URL"

# Listen address: with network_mode: host these are the NAS ports directly.
listen_addr: "0.0.0.0:$DEFAULT_HS_PORT"
metrics_listen_addr: "$METRICS_ADDR"

noise:
  private_key_path: "$HS_DIR/noise_private.key"

database:
  type: sqlite
  sqlite:
    path: "$HS_DIR/db.sqlite"
    write_ahead_log: true

# Embedded DERP relay: STUN is announced on udp/$STUN_PORT and must be opened
# directly on the router/firewall - an HTTP reverse proxy cannot forward UDP.
derp:
  server:
    enabled: true
    region_id: $REGION_ID
    region_code: "$REGION_CODE"
    region_name: "$REGION_NAME"
    stun_listen_addr: "0.0.0.0:$STUN_PORT"
    private_key_path: "$HS_DIR/derp_server_private.key"
  # These are container paths, and they are host paths at the same time: both
  # containers mount this directory at the very same absolute path.
  paths:
    - $DERP_MAP_CTR
  auto_update_enabled: false

unix_socket: "$HS_DIR/headscale.sock"
unix_socket_permission: "0770"

log:
  level: info
  format: text

policy:
  mode: database

logtail:
  enabled: false

taildrop:
  enabled: true
EOF
	return 0
}

hp_config_skeleton() {
	local api_line agent_enabled
	if [[ -n $API_KEY ]]; then
		api_line="  api_key: \"$API_KEY\""
		agent_enabled="true"
	else
		api_line="  # REQUIRED for login, the configuration check and the agent. Create one with:
  #   docker compose exec headscale headscale apikeys create --expiration 90d
  # api_key: \"hskey-api-...\""
		agent_enabled="false"
	fi
	local cookie_secure="true"
	[[ $BASE_URL == https://* ]] || cookie_secure="false"
	cat <<EOF
# HeadplaneCN configuration
# Generated by $SCRIPT_NAME v$SCRIPT_VERSION on $RUN_TS
# Deployment shape: docs/install/dual-image.md
#
# Keep this file readable only by root: it contains the cookie secret and the
# Headscale API key.

server:
  host: "$PANEL_BIND"
  port: $PANEL_PORT

  # The URL the browser uses: scheme + hostname + port, WITHOUT the /admin
  # suffix (the dashboard lives at <base_url>/admin).
  base_url: "$BASE_URL"

  # Exactly 32 characters. Rotating it logs everybody out.
  cookie_secret: "$COOKIE_SECRET"

  # The browser reaches the UI over $([[ $BASE_URL == https://* ]] && echo HTTPS || echo plain HTTP)
  cookie_secure: $cookie_secure

  data_path: "/var/lib/headplane"

headscale:
  # With host networking, 127.0.0.1 inside this container is the NAS itself,
  # which is where the Headscale container listens.
  url: "http://127.0.0.1:$DEFAULT_HS_PORT"

  # Public address shown in the UI and used for browser SSH.
  public_url: "$SERVER_URL"

  # The path of Headscale's effective configuration *inside this container*:
  # the mounted copy of $HS_CONFIG.
  config_path: "/etc/headscale/config.yaml"

$api_line

integration:
  # The panel restarts and recreates Headscale through the Docker socket.
  docker:
    enabled: true
    container_name: "headscale"
    container_label: "me.tale.headplane.target=headscale"
    socket: "unix:///var/run/docker.sock"

  # Sending SIGHUP to a native process needs pid: host and an apparmor
  # exception, which this deployment does not generate; use the Docker
  # integration above instead (see the reverse migration in the docs).
  proc:
    enabled: false

  # Syncs node versions, OS details and DERP regions/latency.
  agent:
    enabled: $agent_enabled
EOF
	return 0
}

# The compose file must keep working after the operator edits BASE_DIR in .env,
# so every host path under the deployment directory is written as ${BASE_DIR}/...
# instead of the absolute path that was answered at the prompt.
compose_path() {
	local p="$1"
	case "$p" in
	"$BASE_DIR") printf '%s' '${BASE_DIR}' ;;
	"$BASE_DIR"/*) printf '%s' '${BASE_DIR}/'"${p#"$BASE_DIR"/}" ;;
	*) printf '%s' "$p" ;;
	esac
	return 0
}

env_content() {
	cat <<EOF
# .env - the single source of truth for this deployment.
# Edit a value here, run "docker compose up -d" again, and no other file has to
# change. Keep this file to root only: it decides where the data lives.

# --- 镜像版本 / image versions ---
HEADSCALE_VERSION=$HS_IMAGE_VERSION
HEADPLANE_VERSION=$HP_IMAGE_VERSION

# --- 容器以哪个用户运行 / container user (0 = root) ---
HEADSCALE_UID=$HEADSCALE_UID
HEADSCALE_GID=$HEADSCALE_GID

# --- 部署目录 / deployment directory ---
BASE_DIR=$BASE_DIR

# --- 面板监听地址 / panel listener ---
PANEL_BIND=$PANEL_BIND
PANEL_PORT=$PANEL_PORT

# --- 时区 / timezone ---
TZ=$TZONE

# --- 镜像代理前缀 / image proxy prefix ---
# 三个镜像（Headscale、面板、Caddy）共用这一个前缀；留空 / 删掉这行 = 直连
# Docker Hub 与 ghcr.io。v6 需要 IPv6，没有 IPv6 就把下面 v4 那行的 # 去掉、
# 并删掉本行（两行只留一行）。
# One prefix for all three images (Headscale, the panel, Caddy); empty or removed
# means a direct pull from Docker Hub / ghcr.io.  v6 needs IPv6, so on a host
# without it swap in the commented v4 line below.
IMAGE_PROXY=$IMAGE_PROXY
#IMAGE_PROXY=$DEFAULT_IMAGE_PROXY_ALT

# --- Caddy：面板前面的路径分流 / the /admin path split in front of the panel ---
# 只有 Lucky 路径分流方案需要它；端口方案 / 多域名方案把这一行和 docker-compose.yml
# 里的 caddy 服务一起删掉。
# Only the Lucky layout needs this: the port / two-domain layouts delete this line
# together with the caddy: service.
CADDY_PORT=$CADDY_PORT
EOF
	return 0
}

build_compose_content() {
	# If the mirror was typed into --headscale-tag / --headplane-tag, strip the
	# prefix back off the repository: IMAGE_PROXY prepends it once per service.
	local hs_repo="${HS_IMAGE_REPO:-}" hp_repo="${HP_IMAGE_REPO:-}"
	if [[ -n ${IMAGE_PROXY:-} ]]; then
		hs_repo="${hs_repo#"$IMAGE_PROXY"}"
		hp_repo="${hp_repo#"$IMAGE_PROXY"}"
	fi
	cat <<EOF
# docker-compose.yml
# Generated by $SCRIPT_NAME v$SCRIPT_VERSION on $RUN_TS
# Deployment shape: docs/install/dual-image.md
#
# Everything that varies lives in .env next to this file:
#   HEADSCALE_VERSION, HEADPLANE_VERSION, HEADSCALE_UID, HEADSCALE_GID,
#   BASE_DIR, PANEL_BIND, PANEL_PORT, TZ, IMAGE_PROXY, CADDY_PORT
#
# Both services use host networking and mount \${BASE_DIR}/headscale at that
# SAME absolute path, so the absolute paths inside the Headscale config.yaml
# keep working unchanged. There is deliberately no ports: section, no
# security_opt and no apparmor override here.

services:
  # --- Headscale -----------------------------------------------------------
  headscale:
    image: "\${IMAGE_PROXY-}$hs_repo:\${HEADSCALE_VERSION:?set HEADSCALE_VERSION in .env}"
    container_name: headscale
    restart: unless-stopped
    network_mode: host
    read_only: true
    tmpfs:
      - /var/run/headscale
      - /tmp
    user: "\${HEADSCALE_UID:-0}:\${HEADSCALE_GID:-0}"
    labels:
      # The panel finds this container by label instead of by name.
      me.tale.headplane.target: "headscale"
    volumes:
      # The config file is the one path that differs: it is read from /etc/headscale.
      - "$(compose_path "$HS_CONFIG"):/etc/headscale/config.yaml:ro"
      # The whole Headscale directory at the SAME absolute path: config.yaml,
      # db.sqlite, the private keys, cache/ and derp-maps/.
      - "$(compose_path "$HS_DIR"):$(compose_path "$HS_DIR")"
    command: serve
    healthcheck:
      test: ["CMD", "headscale", "health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # --- HeadplaneCN ---------------------------------------------------------
  headplaneCN:
    image: "\${IMAGE_PROXY-}$hp_repo:\${HEADPLANE_VERSION:-$HP_IMAGE_VERSION}"
    container_name: headplaneCN
    restart: unless-stopped
    network_mode: host
    # Optional: only the Agent needs the host PID namespace. No security_opt /
    # apparmor exception is generated, because integration.proc is disabled.
    pid: host
    depends_on:
      - headscale
    volumes:
      - "$(compose_path "$HP_CONFIG"):/etc/headplane/config.yaml:ro"
      - "$(compose_path "$HP_DATA"):/var/lib/headplane"
      # The same file and the same directory as in the headscale container.
      - "$(compose_path "$HS_CONFIG"):/etc/headscale/config.yaml"
      - "$(compose_path "$DERP_MAP_DIR"):$(compose_path "$DERP_MAP_DIR")"
      - "$(compose_path "$HS_DIR"):$(compose_path "$HS_DIR"):ro"
      # The panel restarts/recreates the headscale container through this.
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - "TZ=\${TZ}"
      - "HEADPLANE_SERVER__HOST=\${PANEL_BIND}"
      - "HEADPLANE_SERVER__PORT=\${PANEL_PORT}"
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/etc/headscale/config.yaml"
      - "HEADPLANE_INTEGRATION__DOCKER__ENABLED=true"
      - "HEADPLANE_INTEGRATION__DOCKER__CONTAINER_NAME=headscale"
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=false"
    healthcheck:
      # The image's own /bin/hp_healthcheck probes 127.0.0.1, which fails when
      # the panel binds a specific address, so probe PANEL_BIND instead.
      test: ["CMD", "/nodejs/bin/node", "-e", "fetch('http://\${PANEL_BIND}:\${PANEL_PORT}/admin/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # --- Caddy：/admin 路径分流 / the /admin path split -----------------------
  # 只有 Lucky 方案需要它（TLS 在路由器那层终止，Caddy 只做明文分流）；
  # 端口方案 / 多域名方案把这一整段和 .env 里的 CADDY_PORT 一行一起删掉。
  caddy:
    image: "\${IMAGE_PROXY-}caddy:2-alpine"
    container_name: caddy
    restart: unless-stopped
    network_mode: host
    environment:
      - "TZ=\${TZ}"
      - "CADDY_PORT=\${CADDY_PORT:-$DEFAULT_CADDY_PORT}"
    volumes:
      - "$(compose_path "$CADDY_FILE"):/etc/caddy/Caddyfile:ro"
      - "$(compose_path "$CADDY_DIR")/data:/data"
      - "$(compose_path "$CADDY_DIR")/config:/config"
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
EOF
	return 0
}

# The Caddyfile does one thing: it keeps /admin (the panel) separate from
# everything else (Headscale).  TLS is terminated one layer up, so this
# listener speaks plain HTTP and must not ask for a certificate.
caddyfile_content() {
	cat <<EOF
# Caddyfile - /admin 路径分流 / the /admin path split.
# 证书在上一层（路由器上的 Lucky）终止，这里只说明文 HTTP，所以 auto_https off。
# TLS is terminated one layer up (Lucky on the router); this listener is plain
# HTTP, hence "auto_https off".

{
	# 不签发也不加载证书 / no certificate is requested or loaded here
	auto_https off
}

:{\$CADDY_PORT:$DEFAULT_CADDY_PORT} {
	# 浏览器打开根路径时进面板；客户端从不用 GET /
	@browserRoot {
		path /
		header Accept *text/html*
	}
	redir @browserRoot /admin/ 302

	# /admin* 不改写路径，原样转给面板 / the panel keeps its /admin prefix
	handle /admin* {
		reverse_proxy $PANEL_BIND:$PANEL_PORT {
			header_up X-Forwarded-Proto https
		}
	}

	# 其余全部原样透传给 Headscale（/ts2021、/key、/register、/health、/derp …）；
	# flush_interval -1 关掉缓冲，长连接才不会被切断。
	handle {
		reverse_proxy 127.0.0.1:$DEFAULT_HS_PORT {
			flush_interval -1
			header_up X-Forwarded-Proto https
		}
	}
}
EOF
	return 0
}

# -----------------------------------------------------------------------------
# Config writers
# -----------------------------------------------------------------------------
write_headscale_config() {
	local ts="${1:-$RUN_STAMP}" src="" spec="" log="" out="" newfile="" dbtype="" bak=""
	if [[ -f $HS_CONFIG ]]; then
		src="$HS_CONFIG"
	elif ((DRY_RUN)) && [[ -n $MIGRATE_SRC && -f $MIGRATE_SRC/config.yaml ]]; then
		src="$MIGRATE_SRC/config.yaml"
		dim "  [dry-run] reading the config that would be copied from $MIGRATE_SRC"
	fi

	if [[ -z $src ]]; then
		emit ""
		if ((DRY_RUN)); then
			emit "--- would write: $HS_CONFIG (new skeleton) ---"
			hs_config_skeleton | mask_config_lines
			emit "--- end: $HS_CONFIG ---"
		else
			emit "--- new file: $HS_CONFIG ---"
			# process substitution, not a pipe: stage_file must stay in this
			# shell so it can record the file in WRITTEN_FILES
			stage_file "$HS_CONFIG" 600 < <(hs_config_skeleton)
		fi
		emit "  derp.paths entry: $DERP_MAP_CTR"
		return 0
	fi

	dbtype="$(yaml_get "$src" "database.type" 2>/dev/null || true)"
	if [[ -n $dbtype && $dbtype != "sqlite" ]]; then
		die "$src uses database.type: $dbtype; this installer only supports sqlite (refusing to rewrite your config)"
	fi

	spec="$(new_tmp_file)"
	log="$(new_tmp_file)"
	{
		printf 'server_url\tstr\t%s\n' "$SERVER_URL"
		printf 'listen_addr\tstr\t0.0.0.0:%s\n' "$DEFAULT_HS_PORT"
		printf 'metrics_listen_addr\tstr\t%s\n' "$METRICS_ADDR"
		printf 'noise.private_key_path\tstr\t%s/noise_private.key\n' "$HS_DIR"
		printf 'database.type\tstr\tsqlite\n'
		printf 'database.sqlite.path\tstr\t%s/db.sqlite\n' "$HS_DIR"
		printf 'derp.server.enabled\traw\ttrue\n'
		printf 'derp.server.region_id\traw\t%s\n' "$REGION_ID"
		printf 'derp.server.region_code\tstr\t%s\n' "$REGION_CODE"
		printf 'derp.server.region_name\tstr\t%s\n' "$REGION_NAME"
		printf 'derp.server.stun_listen_addr\tstr\t0.0.0.0:%s\n' "$STUN_PORT"
		printf 'derp.server.private_key_path\tstr\t%s/derp_server_private.key\n' "$HS_DIR"
		printf 'derp.paths\tlist\t%s\n' "$DERP_MAP_CTR"
		printf 'unix_socket\tstr\t%s/headscale.sock\n' "$HS_DIR"
	} >"$spec"

	if ((DRY_RUN)); then
		out="$(new_tmp_file)"
		patch_config "$src" "$spec" "$log" >"$out"
		emit ""
		emit "--- would patch: $HS_CONFIG (from $src; the original is kept as .bak) ---"
		mask_config_lines <"$out"
		emit "--- end: $HS_CONFIG ---"
		emit "changes that would be made:"
		print_change_log "$log"
		verify_derp_paths "$out" plan
		return 0
	fi

	# real run: keep a .bak next to the file, then patch
	bak="$HS_CONFIG.bak"
	if [[ ! -e $bak ]]; then
		cp -a "$src" "$bak"
		chmod 600 "$bak" 2>/dev/null || true
		BACKUP_FILES+=("$bak")
		ok "  original kept: $bak"
	else
		local stamped="$HS_CONFIG.bak-$ts"
		cp -a "$src" "$stamped"
		chmod 600 "$stamped" 2>/dev/null || true
		BACKUP_FILES+=("$stamped")
		dim "  $bak already existed; this run also kept $stamped"
	fi
	newfile="$(new_tmp_file)"
	patch_config "$src" "$spec" "$log" >"$newfile"
	if cmp -s "$src" "$newfile"; then
		dim "  $HS_CONFIG already matches the required values (no change)"
		emit "  no change needed: $HS_CONFIG"
	else
		stage_file "$HS_CONFIG" 600 <"$newfile"
		chmod 600 "$HS_CONFIG" 2>/dev/null || true
	fi
	emit "  changes applied to $HS_CONFIG:"
	print_change_log "$log"
	verify_derp_paths "$HS_CONFIG" real
	if have diff; then
		local d
		d="$(diff -u "$bak" "$HS_CONFIG" 2>/dev/null || true)"
		if [[ -n $d ]]; then
			emit "  unified diff (secrets masked):"
			printf '%s\n' "$d" | mask_config_lines | sed 's/^/    /'
		fi
	fi
	return 0
}

write_headplane_config() {
	local ts="${1:-$RUN_STAMP}" src="" spec="" log="" out="" newfile=""
	if [[ -f $HP_CONFIG ]]; then
		src="$HP_CONFIG"
	fi
	if [[ -z $src ]]; then
		if ((DRY_RUN)); then
			emit ""
			emit "--- would write: $HP_CONFIG (new file) ---"
			hp_config_skeleton | mask_config_lines
			emit "--- end: $HP_CONFIG ---"
		else
			stage_file "$HP_CONFIG" 600 < <(hp_config_skeleton)
		fi
		return 0
	fi

	spec="$(new_tmp_file)"
	log="$(new_tmp_file)"
	{
		printf 'server.host\tstr\t%s\n' "$PANEL_BIND"
		printf 'server.port\traw\t%s\n' "$PANEL_PORT"
		printf 'server.base_url\tstr\t%s\n' "$BASE_URL"
		printf 'server.cookie_secure\traw\t%s\n' "$([[ $BASE_URL == https://* ]] && echo true || echo false)"
		printf 'server.data_path\tstr\t%s\n' "/var/lib/headplane"
		((KEEP_COOKIE == 0)) && printf 'server.cookie_secret\tstr\t%s\n' "$COOKIE_SECRET"
		printf 'headscale.url\tstr\thttp://127.0.0.1:%s\n' "$DEFAULT_HS_PORT"
		printf 'headscale.public_url\tstr\t%s\n' "$SERVER_URL"
		printf 'headscale.config_path\tstr\t%s\n' "/etc/headscale/config.yaml"
		[[ -n $API_KEY ]] && printf 'headscale.api_key\tstr\t%s\n' "$API_KEY"
		printf 'integration.docker.enabled\traw\ttrue\n'
		printf 'integration.docker.container_name\tstr\theadscale\n'
		printf 'integration.docker.container_label\tstr\tme.tale.headplane.target=headscale\n'
		printf 'integration.docker.socket\tstr\tunix:///var/run/docker.sock\n'
		printf 'integration.proc.enabled\traw\tfalse\n'
		printf 'integration.agent.enabled\traw\t%s\n' "$([[ -n $API_KEY ]] && echo true || echo false)"
	} >"$spec"

	if ((DRY_RUN)); then
		out="$(new_tmp_file)"
		patch_config "$src" "$spec" "$log" >"$out"
		emit ""
		emit "--- would patch: $HP_CONFIG (original kept as $HP_CONFIG.bak-$ts) ---"
		mask_config_lines <"$out"
		emit "--- end: $HP_CONFIG ---"
		emit "changes that would be made:"
		print_change_log "$log"
		return 0
	fi

	local bak="$HP_CONFIG.bak-$ts"
	cp -a "$src" "$bak"
	chmod 600 "$bak" 2>/dev/null || true
	BACKUP_FILES+=("$bak")
	ok "  backed up: $HP_CONFIG -> $bak"
	newfile="$(new_tmp_file)"
	patch_config "$src" "$spec" "$log" >"$newfile"
	if cmp -s "$src" "$newfile"; then
		dim "  $HP_CONFIG already matches the required values (no change)"
	else
		stage_file "$HP_CONFIG" 600 <"$newfile"
	fi
	emit "  changes applied to $HP_CONFIG:"
	print_change_log "$log"
	return 0
}

print_change_log() {
	local log="$1" kind key old new note n=0
	[[ -s $log ]] || {
		dim "  (no changes)"
		return 0
	}
	while IFS=$'\t' read -r kind key old new note; do
		[[ -n ${kind:-} ]] || continue
		n=$((n + 1))
		if is_secret_key "$key"; then
			old="$(mask_secret "$old")"
			new="$(mask_secret "$new")"
		fi
		case "$kind" in
		CHANGE) emit "    ~ $key: $old  ->  $new" ;;
		ADD) emit "    + $key: $new" ;;
		MANUAL) emit "    ! $key: $note" ;;
		NOTE) emit "    * $key: $note" ;;
		DROP) emit "    - $key: $old ($note)" ;;
		*) emit "    $kind $key $old $new $note" ;;
		esac
	done <"$log"
	((n == 0)) && dim "  (no changes)"
	return 0
}

# -----------------------------------------------------------------------------
# Plan / summary
# -----------------------------------------------------------------------------
# The resolved layout: printed once per run (dry run and real run alike), before
# anything is written, and reused verbatim for the volumes: entries.
print_layout() {
	info "  deployment directory : $BASE_DIR"
	info "  Headscale directory  : $HS_DIR"
	info "        mounted at the SAME absolute path in both containers"
	info "        (config.yaml, db.sqlite, the private keys, cache/ and derp-maps/)"
	info "  Headscale config     : $HS_CONFIG"
	info "        -> /etc/headscale/config.yaml (ro in headscale, rw in HeadplaneCN)"
	info "  DERP map directory   : $DERP_MAP_DIR"
	info "        -> the SAME absolute path in both containers (rw)"
	info "  HeadplaneCN config   : $HP_CONFIG"
	info "        -> /etc/headplane/config.yaml (ro)"
	info "  HeadplaneCN data     : $HP_DATA"
	info "        -> /var/lib/headplane (rw)"
	info "  Caddyfile            : $CADDY_FILE"
	info "        -> /etc/caddy/Caddyfile (ro; the /admin path split)"
	info "  .env file            : $ENV_FILE"
	info "  compose file         : $COMPOSE_FILE"
	info "  backups              : $BACKUP_DIR"
	if ((LAYOUT_COLLISION)); then
		warn "two of the paths above are the same; the containers would share that directory"
	fi
	return 0
}

print_plan() {
	head2 "PLAN"
	if ((DRY_RUN)); then
		info "  dry run: nothing below is written and no container is started."
	else
		info "  apply: the files below are written after your confirmation."
	fi
	print_layout
	info "  images               : headscale=$HS_IMAGE  panel=$HP_IMAGE"
	info "  networking           : network_mode: host for both containers (no ports: section)"
	info "  timezone             : $TZONE"
	info "  headscale listeners  : tcp/$DEFAULT_HS_PORT (control + /health), tcp/$DEFAULT_METRICS_PORT (metrics), tcp/50443 (gRPC, loopback only), udp/$STUN_PORT (STUN)"
	info "  panel listener       : tcp/$PANEL_BIND:$PANEL_PORT (panel + /admin/healthz)"
	info "  client server_url    : $SERVER_URL"
	info "  DERP endpoint        : $DERP_URL"
	info "  admin UI             : $ADMIN_URL/admin"
	if [[ -n $API_KEY ]]; then
		info "  headscale.api_key    : set (masked: $(mask_secret "$API_KEY"))"
	else
		info "  headscale.api_key    : not set yet ($API_KEY_STATE)"
	fi
	info "  cookie_secret        : ${COOKIE_STATE:-generated}"
	info ""
	info "directories:"
	emit "    mkdir -p -m 755 $BASE_DIR"
	emit "    mkdir -p -m 700 $HP_DATA"
	emit "    mkdir -p -m 755 $HS_DIR"
	emit "    mkdir -p -m 755 $DERP_MAP_DIR"
	emit "    mkdir -p -m 700 $BACKUP_DIR"
	emit "    mkdir -p -m 755 $CADDY_DIR   (with data/ and config/)"
	info ""
	info "files:"
	emit "    $ENV_FILE   (mode 600)"
	emit "    $HS_CONFIG   (kept and patched, or written new; mode 600)"
	emit "    $HP_CONFIG   (kept and patched, or written new; mode 600)"
	emit "    $DERP_MAP_HOST   (empty placeholder, only when missing)"
	emit "    $COMPOSE_FILE   (mode 644)"
	emit "    $CADDY_FILE   (mode 644; the /admin path split)"
	if ((MIGRATE_ACTIVE)); then
		info ""
		info "migration:"
		plan_migration
	fi
	info ""
	info "the compose file that will be written:"
	build_compose_content | sed 's/^/    /'
	info ""
	info "the .env file that will be written:"
	env_content | sed 's/^/    /'
	info ""
	info "the caddy/Caddyfile that will be written:"
	caddyfile_content | sed 's/^/    /'
	info ""
	info "permissions:"
	emit "    chmod 600 $ENV_FILE $HS_CONFIG $HP_CONFIG"
	emit "    chmod 600 $HS_DIR/noise_private.key $HS_DIR/derp_server_private.key"
	if ((ROOT_UID)); then
		emit "    chown -R $HEADSCALE_UID:$HEADSCALE_GID $HS_DIR"
	else
		emit "    # not root: run chown -R $HEADSCALE_UID:$HEADSCALE_GID $HS_DIR yourself"
	fi
	info ""
	info "commands the operator will run afterwards:"
	emit "    cd $BASE_DIR && docker compose up -d"
	emit "    docker compose ps"
	emit "    docker compose exec headscale headscale health"
	emit "    curl -s http://127.0.0.1:$DEFAULT_HS_PORT/health"
	return 0
}

print_summary() {
	local b w c
	head2 "SUMMARY (safe to copy)"
	emit "  deployment directory : $BASE_DIR"
	emit "  compose file         : $COMPOSE_FILE"
	emit "  .env file            : $ENV_FILE"
	emit "  Headscale config     : $HS_CONFIG   -> /etc/headscale/config.yaml (ro)"
	emit "  Headscale directory  : $HS_DIR"
	emit "                         -> mounted at the SAME absolute path in both containers"
	emit "  HeadplaneCN config   : $HP_CONFIG   -> /etc/headplane/config.yaml (ro)"
	emit "  HeadplaneCN data     : $HP_DATA   -> /var/lib/headplane"
	emit "  DERP map directory   : $DERP_MAP_DIR   -> the SAME absolute path (rw)"
	emit "  Caddyfile            : $CADDY_FILE   -> /etc/caddy/Caddyfile (ro)"
	emit "  backups              : $BACKUP_DIR"
	emit "  images               : headscale=$HS_IMAGE  panel=$HP_IMAGE"
	emit "  clients use          : $SERVER_URL"
	emit "  DERP endpoint        : $DERP_URL"
	emit "  admin UI             : $ADMIN_URL/admin"
	if [[ -n $API_KEY ]]; then
		emit "  headscale.api_key    : set (masked: $(mask_secret "$API_KEY"))"
	else
		emit "  headscale.api_key    : $API_KEY_STATE"
	fi
	emit "  cookie_secret        : ${COOKIE_STATE:-generated}"
	emit ""
	emit "start     : cd $BASE_DIR && docker compose up -d"
	emit "status    : cd $BASE_DIR && docker compose ps"
	emit "health    : curl -s http://127.0.0.1:$DEFAULT_HS_PORT/health"
	emit "headscale : cd $BASE_DIR && docker compose exec headscale headscale health"
	emit "upgrade   : edit HEADSCALE_VERSION / HEADPLANE_VERSION in $ENV_FILE, then:"
	emit "            cd $BASE_DIR && docker compose pull && docker compose up -d"
	emit "backup    : tar -czf $BACKUP_DIR/headplaneCN-\$(date +%Y%m%d-%H%M%S).tar.gz -C $BASE_DIR ."
	emit "rollback  : put the two old versions back in $ENV_FILE, then: cd $BASE_DIR && docker compose up -d"
	emit ""
	emit "  * all three containers use the host network (the port / two-domain"
	emit "    reverse proxy (or a firewall) has to front http://$PANEL_BIND:$PANEL_PORT."
	emit "  * the panel reaches Headscale on 127.0.0.1:$DEFAULT_HS_PORT inside the host."
	emit "  * $HS_DIR is the single source of Headscale state; back it up before upgrades."
	if [ "${API_KEY_NEEDED_HINT:-0}" = 1 ]; then
		emit ""
		emit "TODO: Headscale has no API key yet, so the panel cannot drive it:"
		emit "  1. cd $BASE_DIR && docker compose exec headscale headscale apikeys create --expiration 90d"
		emit "  2. paste the key into headscale.api_key in $HP_CONFIG and restart headplaneCN"
	fi
	emit ""
	emit "files kept as .bak-$RUN_STAMP:"
	if ((${#BACKUP_FILES[@]})); then
		for b in "${BACKUP_FILES[@]}"; do emit "  $b"; done
	else
		emit "  (none)"
	fi
	emit "files written:"
	if ((${#WRITTEN_FILES[@]})); then
		for w in "${WRITTEN_FILES[@]}"; do emit "  $w"; done
	else
		emit "  (none)"
	fi
	emit "files copied:"
	if ((${#COPIED_FILES[@]})); then
		for c in "${COPIED_FILES[@]}"; do emit "  $c"; done
	else
		emit "  (none)"
	fi
	return 0
}

run_verification() {
	local i ok_health=0
	info ""
	info "verifying the deployment (this can take a few seconds)..."
	if have curl; then
		for i in 1 2 3 4 5 6; do
			if curl -fsS "http://127.0.0.1:$DEFAULT_HS_PORT/health" 2>/dev/null | grep -q '"status"'; then
				ok_health=1
				break
			fi
			sleep 2
		done
	fi
	emit "  \$ cd $BASE_DIR && docker compose ps"
	(cd "$BASE_DIR" && docker compose ps) || warn "'docker compose ps' failed"
	emit ""
	emit "  \$ cd $BASE_DIR && docker compose logs --tail=30 headscale"
	(cd "$BASE_DIR" && docker compose logs --tail=30 headscale) || warn "'docker compose logs headscale' failed"
	emit ""
	emit "  \$ cd $BASE_DIR && docker compose logs --tail=40 headscale | grep -iE 'error|derp' | tail"
	(cd "$BASE_DIR" && docker compose logs --tail=40 headscale 2>/dev/null | grep -iE 'error|derp' | tail) || true
	emit ""
	emit "  \$ cd $BASE_DIR && docker compose exec -T headscale headscale health"
	(cd "$BASE_DIR" && docker compose exec -T headscale headscale health) || warn "Headscale does not report healthy yet; check 'docker compose logs headscale'"
	emit ""
	emit "  \$ cd $BASE_DIR && docker compose exec -T headscale headscale configtest"
	(cd "$BASE_DIR" && docker compose exec -T headscale headscale configtest) || warn "headscale configtest failed; fix $HS_CONFIG before using the panel"
	emit ""
	emit "  \$ cd $BASE_DIR && docker compose exec -T headscale headscale nodes list"
	(cd "$BASE_DIR" && docker compose exec -T headscale headscale nodes list | head) || warn "'headscale nodes list' failed (an empty list is fine on a fresh install)"
	emit ""
	emit "  \$ cd $BASE_DIR && docker compose logs --tail=40 headplaneCN | grep -iE 'valid Headscale configuration|Using Docker integration|Listening on'"
	(cd "$BASE_DIR" && docker compose logs --tail=40 headplaneCN 2>/dev/null | grep -iE 'valid Headscale configuration|Using Docker integration|Listening on') ||
		warn "those panel log lines were not found yet; give the panel a few more seconds"
	if ((ok_health)); then
		ok "Headscale answered on http://127.0.0.1:$DEFAULT_HS_PORT/health"
	else
		warn "curl http://127.0.0.1:$DEFAULT_HS_PORT/health did not answer yet"
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Help / self test
# -----------------------------------------------------------------------------
usage() {
	cat <<'EOF'
dual-image-install.sh - install the two-container deployment of Headscale and
HeadplaneCN that docs/install/dual-image.md describes.

The whole stack is one directory with one .env file:

  <base>/docker-compose.yml     both services, host networking, no ports:
  <base>/.env                   versions, container user, BASE_DIR, panel bind, TZ
  <base>/config.yaml            HeadplaneCN panel configuration
  <base>/data/                  panel data            -> /var/lib/headplane
  <base>/headscale/             Headscale config and ALL of its data
                                (config.yaml, db.sqlite, the private keys,
                                 cache/ and derp-maps/) -> mounted at the SAME
                                absolute path in both containers, so the
                                absolute paths in config.yaml keep working
  <base>/backup/                timestamped tar.gz backups

USAGE
  bash scripts/dual-image-install.sh [options]

FLAGS
  -h, --help              show this help and exit
  -n, --dry-run           print the plan and every file that would be written;
                          write nothing and start nothing
      --self-test         run the built-in self test (no docker, no network)
      --defaults          accept every default and never prompt
      --base-dir PATH     deployment directory (default: /vol1/1000/APP/headplaneCN)
      --headscale-tag IMG Headscale image as repo:tag (default: headscale/headscale:0.29.4)
      --headplane-tag IMG HeadplaneCN image as repo:tag
                          (default: ghcr.io/cgg888/headplanecn:0.22.23)
      --server-url URL    the URL clients use (Headscale server_url)
      --derp-host H[:P]   embedded DERP host clients reach; "none" disables it
      --admin-host H[:P]  host the admin UI is reverse proxied from
      --admin-port PORT   port the panel listens on (default: 4100)
      --admin-bind ADDR   address the panel binds: 0.0.0.0 (not recommended),
                          127.0.0.1 (reverse proxy on this host) or a specific
                          address such as 192.168.1.10 (default)
      --caddy-port PORT   plain-HTTP port of the bundled Caddy path splitter
                          (default: 8444; only the Lucky layout needs it)
      --image-proxy PFX   registry prefix prepended to all three images
                          (default: v6.gh-proxy.org/docker/; "off" = direct pull)
      --stun-port PORT    STUN port of the embedded DERP server (default: 3478)
      --region-id N       embedded DERP region id (default: 999)
      --tz ZONE           timezone for both containers (default: the host's)
      --version           print the script version and exit

PROMPTS
   1. deployment directory (default /vol1/1000/APP/headplaneCN)
   2. HeadplaneCN config file, then the HeadplaneCN data directory
   3. Headscale directory, then the DERP map directory inside it
   4. Headscale image, then the HeadplaneCN image
   5. client server_url, embedded DERP host, admin UI host
   6. panel bind address, panel port, STUN port, metrics address, timezone
   7. Headscale API key, panel cookie_secret, DERP region id/code/name
   8. whether to copy an existing Headscale directory
      (default /vol1/@appdata/headscale) into the new one

WHAT IT WRITES
  * .env and docker-compose.yml in the deployment directory (600 / 644)
  * caddy/Caddyfile: the /admin path split in front of the panel (644)
  * the panel config.yaml, patching only the keys this installer owns
  * the Headscale config.yaml, keeping every absolute path inside the
    deployment directory: nothing is rewritten to /etc/headscale/... or
    /var/lib/headscale/... because $BASE_DIR/headscale is mounted at the same
    absolute path inside both containers
  * a placeholder DERP map when the file does not exist yet
  * the directories above, plus a timestamped tar.gz in <base>/backup/

WHAT IT NEVER DOES
  * no git, no 'rm -rf', no deletion or move of your data
  * never overwrites a file without keeping a .bak copy next to it
  * never starts a container without the final confirmation

Every write is printed before it happens; --dry-run shows the complete result
and changes nothing outside a private temporary directory.
EOF
	return 0
}

self_test() {
	local T fails=0 checks=0
	T="$(new_tmp_dir)"

	_ok() {
		printf '  %sPASS%s  %s\n' "$C_GRN" "$C_OFF" "$1"
		checks=$((checks + 1))
	}
	_bad() {
		printf '  %sFAIL%s  %s\n' "$C_RED" "$C_OFF" "$1"
		checks=$((checks + 1))
		fails=$((fails + 1))
	}
	_y() { # description function value
		if "$2" "$3" >/dev/null 2>&1; then
			_ok "$1 accepts '$3'"
		else
			_bad "$1 should accept '$3'"
		fi
	}
	_n() { # description function value
		if "$2" "$3" >/dev/null 2>&1; then
			_bad "$1 should reject '$3'"
		else
			_ok "$1 rejects '$3'"
		fi
	}
	_eq() { # description expected actual
		if [ "$2" = "$3" ]; then
			_ok "$1"
		else
			_bad "$1 (expected '$2', got '$3')"
		fi
	}
	_has() { # file fixed-string description
		if grep -Fq -- "$2" "$1"; then
			_ok "$3"
		else
			_bad "$3 (missing '$2')"
		fi
	}
	_hasnt() { # file fixed-string description
		if grep -Fq -- "$2" "$1"; then
			_bad "$3 (found '$2')"
		else
			_ok "$3"
		fi
	}
	_count() { # description expected file fixed-string
		local n
		n="$(grep -Fc -- "$4" "$3" 2>/dev/null || true)"
		[ -n "$n" ] || n=0
		_eq "$1" "$2" "$n"
	}

	head2 "Self test"
	info "hermetic: no docker, no network, nothing written outside $T"
	info ""

	# --- validators --------------------------------------------------------
	_y "v_abs_path" v_abs_path "/vol1/1000/APP/headplaneCN"
	_y "v_abs_path" v_abs_path "/vol1/1000/APP/my headplane"
	_n "v_abs_path" v_abs_path "relative/path"
	_n "v_abs_path" v_abs_path "/vol1/../etc"
	_n "v_abs_path" v_abs_path ""

	printf 'x\n' >"$T/plain-file"
	_y "v_host_dir" v_host_dir "$T"
	_n "v_host_dir" v_host_dir "$T/plain-file"
	_y "v_host_file" v_host_file "$T/new-config.yaml"
	_n "v_host_file" v_host_file "$T"

	_y "v_image_ref" v_image_ref "headscale/headscale:0.29.4"
	_y "v_image_ref" v_image_ref "ghcr.io/cgg888/headplanecn:0.22.23"
	_n "v_image_ref" v_image_ref "headscale/headscale"
	_n "v_image_ref" v_image_ref "headscale/headscale:latest"
	_n "v_image_ref" v_image_ref ":0.29.4"

	_y "v_image_proxy" v_image_proxy "v6.gh-proxy.org/docker/"
	_y "v_image_proxy" v_image_proxy "https://v4.gh-proxy.org/docker"
	_y "v_image_proxy" v_image_proxy "off"
	_y "v_image_proxy" v_image_proxy "none"
	_n "v_image_proxy" v_image_proxy "v6.gh-proxy.org/docker/; rm -rf /"
	_n "v_image_proxy" v_image_proxy "v6.gh-proxy.org/../docker/"
	_eq "normalize_image_proxy drops the scheme and keeps one trailing slash" \
		"v6.gh-proxy.org/docker/" "$(normalize_image_proxy 'https://v6.gh-proxy.org/docker')"
	_eq "normalize_image_proxy maps off to a direct pull" "" "$(normalize_image_proxy off)"

	_y "v_port" v_port "1"
	_y "v_port" v_port "4100"
	_y "v_port" v_port "65535"
	_n "v_port" v_port "0"
	_n "v_port" v_port "65536"
	_n "v_port" v_port "4100a"

	_y "v_bind_addr" v_bind_addr "0.0.0.0"
	_y "v_bind_addr" v_bind_addr "127.0.0.1"
	_y "v_bind_addr" v_bind_addr "192.168.1.10"
	_n "v_bind_addr" v_bind_addr "panel.example.com"
	_n "v_bind_addr" v_bind_addr "192.168.1.300"
	_n "v_bind_addr" v_bind_addr ""

	_y "v_hostname" v_hostname "ha.example.com"
	_n "v_hostname" v_hostname "ha_example.com"
	_y "v_http_url" v_http_url "https://ha.example.com:8443"
	_n "v_http_url" v_http_url "ha.example.com"
	_n "v_http_url" v_http_url "https://ha.example.com/admin"
	_y "v_host_port_opt" v_host_port_opt "none"
	_y "v_host_port_opt" v_host_port_opt "direct"
	_y "v_host_port_opt" v_host_port_opt "ha.example.com:443"
	_n "v_host_port_opt" v_host_port_opt "http://ha.example.com"
	_y "v_tz" v_tz "Asia/Shanghai"
	_n "v_tz" v_tz "Nowhere Elsewhere"
	_n "v_tz" v_tz "9Bad/Zone"
	_n "v_tz" v_tz ""
	_n "v_secret32" v_secret32 "0123456789abcdef0123456789abcde"
	_y "v_secret32" v_secret32 "0123456789abcdef0123456789abcdef"
	_n "v_nonempty" v_nonempty ""
	_y "v_nonempty" v_nonempty "x"
	_y "v_region_id" v_region_id "999"
	_n "v_region_id" v_region_id "0"
	_n "v_region_id" v_region_id "65536"

	# --- nothing is created before the operator confirms ---------------------
	if declare -f step_base_dir | grep -Eq '(^|[^a-z])(mkdir|mktemp|stage_file|act_mkdir|act_copy)([^a-z]|$)'; then
		_bad "step_base_dir must not create anything"
	else
		_ok "step_base_dir only asks questions and validates paths"
	fi
	if declare -f step_network | grep -Eq '(^|[^a-z])(mkdir|mktemp|stage_file|act_mkdir|act_copy)([^a-z]|$)'; then
		_bad "step_network must not create anything"
	else
		_ok "step_network only asks questions and validates addresses"
	fi

	# --- the same-absolute-path layout -------------------------------------
	HS_DIR="$T/hs"
	HS_CONFIG="$HS_DIR/config.yaml"
	mkdir -p "$HS_DIR/derp-maps"
	DERP_MAP_DIR="$HS_DIR/derp-maps"
	DERP_MAP_HOST="$DERP_MAP_DIR/official-mirror.yaml"
	DERP_MAP_CTR="$DERP_MAP_HOST"
	_y "v_derp_dir" v_derp_dir "$DERP_MAP_DIR"
	_y "v_derp_dir" v_derp_dir "$HS_DIR"
	_n "v_derp_dir" v_derp_dir "$T/elsewhere"
	_y "v_container_path" v_container_path "$DERP_MAP_CTR"
	_y "v_container_path" v_container_path "/etc/headscale/config.yaml"
	_n "v_container_path" v_container_path "/var/lib/headscale/db.sqlite"
	_n "v_container_path" v_container_path "$T/elsewhere/map.yaml"

	_eq "norm_path drops the trailing /" "/vol1/1000/APP/headplaneCN" "$(norm_path "/vol1/1000/APP/headplaneCN/")"
	_eq "norm_path leaves a plain path alone" "/vol1/@appdata/headscale" "$(norm_path "/vol1/@appdata/headscale")"

	# --- the YAML reader ---------------------------------------------------
	cat >"$T/panel.yaml" <<'YAML'
server:
  host: "192.168.1.10"
  port: 4100 # the panel port
headscale:
  url: "http://127.0.0.1:8480"
  config_path: "/etc/headscale/config.yaml"
integration:
  docker:
    enabled: true
  proc:
    enabled: false
YAML
	_eq "yaml_get reads a quoted scalar" "192.168.1.10" "$(yaml_get "$T/panel.yaml" server.host)"
	_eq "yaml_get reads an integer" "4100" "$(yaml_get "$T/panel.yaml" server.port)"
	_eq "yaml_get reads a nested scalar" "http://127.0.0.1:8480" "$(yaml_get "$T/panel.yaml" headscale.url)"
	_eq "yaml_get reads a boolean" "false" "$(yaml_get "$T/panel.yaml" integration.proc.enabled)"
	_eq "yaml_get is empty for a missing key" "" "$(yaml_get "$T/panel.yaml" headscale.api_key)"

	# --- the config patcher ------------------------------------------------
	cat >"$T/hs-old.yaml" <<YAML
# Headscale configuration (self test)
server_url: "https://old.example.com"
listen_addr: "0.0.0.0:8080"
metrics_listen_addr: "127.0.0.1:9090"
noise:
  private_key_path: "/old/place/noise_private.key"
database:
  type: sqlite
  sqlite:
    path: "/old/place/db.sqlite"
derp:
  server:
    enabled: true
    region_id: 1
  paths:
    - /vol1/@appdata/headscale/derp-maps/official-mirror.yaml
policy:
  mode: database
YAML
	SERVER_URL="https://ha.example.com:8443"
	METRICS_ADDR="127.0.0.1:8481"
	REGION_ID="999"
	{
		printf 'server_url\tstr\t%s\n' "$SERVER_URL"
		printf 'listen_addr\tstr\t%s\n' "0.0.0.0:$DEFAULT_HS_PORT"
		printf 'metrics_listen_addr\tstr\t%s\n' "$METRICS_ADDR"
		printf 'noise.private_key_path\tstr\t%s\n' "$HS_DIR/noise_private.key"
		printf 'database.type\tstr\t%s\n' "sqlite"
		printf 'database.sqlite.path\tstr\t%s\n' "$HS_DIR/db.sqlite"
		printf 'derp.server.enabled\traw\t%s\n' "true"
		printf 'derp.server.region_id\traw\t%s\n' "$REGION_ID"
		printf 'derp.paths\tlist\t%s\n' "$DERP_MAP_CTR"
	} >"$T/spec.tsv"
	if patch_config "$T/hs-old.yaml" "$T/spec.tsv" "$T/changes.log" >"$T/hs-new.yaml" 2>/dev/null; then
		_ok "patch_config produced a config"
	else
		_bad "patch_config failed"
	fi
	_has "$T/hs-new.yaml" "$SERVER_URL" "the patcher rewrites server_url"
	_hasnt "$T/hs-new.yaml" "https://old.example.com" "the old server_url is gone"
	_has "$T/hs-new.yaml" "$HS_DIR/noise_private.key" "the patcher points noise.private_key_path at the deployment directory"
	_has "$T/hs-new.yaml" "$HS_DIR/db.sqlite" "the patcher points database.sqlite.path at the deployment directory"
	_hasnt "$T/hs-new.yaml" "/old/place" "the stale host paths are gone"
	_has "$T/hs-new.yaml" "$DERP_MAP_CTR" "the stale derp.paths entry becomes the same-absolute-path map"
	_hasnt "$T/hs-new.yaml" "/vol1/@appdata" "no /vol1/@appdata path is left in the config"
	_hasnt "$T/hs-new.yaml" "/etc/headscale/derp-maps" "the DERP map is not moved into /etc/headscale/derp-maps"
	_hasnt "$T/hs-new.yaml" "/var/lib/headscale" "nothing points into /var/lib/headscale"
	_has "$T/hs-new.yaml" "# Headscale configuration (self test)" "the patcher keeps comments"
	_has "$T/hs-new.yaml" "policy:" "the patcher keeps blocks it does not own"
	_has "$T/changes.log" "CHANGE" "the patcher recorded its changes"
	if patch_config "$T/hs-new.yaml" "$T/spec.tsv" "$T/changes2.log" >"$T/hs-new2.yaml" 2>/dev/null &&
		cmp -s "$T/hs-new.yaml" "$T/hs-new2.yaml"; then
		_ok "a second pass over an already patched config changes nothing"
	else
		_bad "the patcher is not idempotent"
	fi

	# --- derp.paths has to be readable inside the container ----------------
	printf 'regions: {}\n' >"$DERP_MAP_HOST"
	if (verify_derp_paths "$T/hs-new.yaml" real) >/dev/null 2>&1; then
		_ok "verify_derp_paths accepts a map that exists"
	else
		_bad "verify_derp_paths rejected a map that exists"
	fi
	cat >"$T/hs-broken.yaml" <<YAML
derp:
  paths:
    - $DERP_MAP_DIR/does-not-exist.yaml
YAML
	if (verify_derp_paths "$T/hs-broken.yaml" real) >/dev/null 2>&1; then
		_bad "verify_derp_paths must stop a real run on a missing map"
	else
		_ok "verify_derp_paths stops a real run on a missing map"
	fi
	if (verify_derp_paths "$T/hs-broken.yaml" plan) >/dev/null 2>&1; then
		_ok "verify_derp_paths only warns in a dry run"
	else
		_bad "verify_derp_paths must not stop a dry run"
	fi

	# --- the migration copies, never moves ---------------------------------
	if have tar; then
		mkdir -p "$T/native/derp-maps" "$T/backup"
		printf 'x\n' >"$T/native/db.sqlite"
		printf 'x\n' >"$T/native/noise_private.key"
		printf 'x\n' >"$T/native/derp_server_private.key"
		printf 'x\n' >"$T/native/headscale.log"
		printf 'x\n' >"$T/native/headscale.pid"
		printf 'x\n' >"$T/native/headscale.sock"
		printf 'x\n' >"$T/native/derp-maps/official-mirror.yaml"
		cat >"$T/native/config.yaml" <<YAML
server_url: "https://ha.example.com:8443"
noise:
  private_key_path: "$T/native/noise_private.key"
YAML
		MIGRATE_SRC="$T/native"
		MIGRATE_ACTIVE=1
		BACKUP_DIR="$T/backup"
		HS_DIR="$T/hs-migrated"
		HS_CONFIG="$HS_DIR/config.yaml"
		mkdir -p "$HS_DIR"
		RUN_STAMP="selftest"
		ROOT_UID=0
		HEADSCALE_UID="0"
		HEADSCALE_GID="0"
		if run_migration >/dev/null 2>&1; then
			_ok "run_migration finished"
		else
			_bad "run_migration failed"
		fi
		_mig_archive="$BACKUP_DIR/native-headscale-selftest.tar.gz"
		if [ -s "$_mig_archive" ]; then
			_ok "the migration wrote a timestamped backup into $BACKUP_DIR"
		else
			_bad "the migration did not write a backup"
		fi
		if [ -f "$MIGRATE_SRC/db.sqlite" ] && [ -f "$MIGRATE_SRC/config.yaml" ]; then
			_ok "the source directory is left untouched (copy, never move)"
		else
			_bad "the migration moved or deleted source files"
		fi
		for _f in config.yaml db.sqlite noise_private.key derp_server_private.key; do
			if [ -e "$HS_DIR/$_f" ]; then
				_ok "the migration copied $_f"
			else
				_bad "the migration did not copy $_f"
			fi
		done
		for _f in headscale.log headscale.pid headscale.sock; do
			if [ -e "$HS_DIR/$_f" ]; then
				_bad "the migration left the runtime file $_f in the copy"
			else
				_ok "the migration dropped the runtime file $_f"
			fi
		done
	else
		dim "  (tar is missing: the migration test is skipped)"
	fi

	# --- .env, compose and both config skeletons ---------------------------
	BASE_DIR="/vol1/1000/APP/headplaneCN"
	HP_CONFIG="$BASE_DIR/config.yaml"
	HP_DATA="$BASE_DIR/data"
	HS_DIR="$BASE_DIR/headscale"
	HS_CONFIG="$HS_DIR/config.yaml"
	DERP_MAP_DIR="$HS_DIR/derp-maps"
	DERP_MAP_HOST="$DERP_MAP_DIR/official-mirror.yaml"
	DERP_MAP_CTR="$DERP_MAP_HOST"
	BACKUP_DIR="$BASE_DIR/backup"
	ENV_FILE="$BASE_DIR/.env"
	COMPOSE_FILE="$BASE_DIR/docker-compose.yml"
	HS_IMAGE_REPO="headscale/headscale"
	HS_IMAGE_VERSION="0.29.4"
	HP_IMAGE_REPO="ghcr.io/cgg888/headplanecn"
	HP_IMAGE_VERSION="0.22.23"
	PANEL_BIND="192.168.1.10"
	PANEL_PORT="4100"
	CADDY_DIR="$BASE_DIR/caddy"
	CADDY_FILE="$CADDY_DIR/Caddyfile"
	IMAGE_PROXY="$DEFAULT_IMAGE_PROXY"
	CADDY_PORT="8444"
	HEADSCALE_UID="0"
	HEADSCALE_GID="0"
	STUN_PORT="3478"
	GRPC_ADDR="127.0.0.1:50443"
	TZONE="Asia/Shanghai"
	BASE_URL="https://ha.example.com:8443"
	DERP_URL="ha.example.com:3478"
	COOKIE_SECRET="0123456789abcdef0123456789abcdef"
	API_KEY=""
	AGENT_ENABLED="0"

	env_content >"$T/env"
	for _k in HEADSCALE_VERSION HEADPLANE_VERSION HEADSCALE_UID HEADSCALE_GID BASE_DIR PANEL_BIND PANEL_PORT TZ IMAGE_PROXY CADDY_PORT; do
		if grep -Eq "^$_k=" "$T/env"; then
			_ok ".env defines $_k"
		else
			_bad ".env must define $_k"
		fi
	done

	build_compose_content >"$T/compose.yml"
	for _k in HEADSCALE_VERSION HEADPLANE_VERSION HEADSCALE_UID HEADSCALE_GID BASE_DIR PANEL_BIND PANEL_PORT TZ IMAGE_PROXY CADDY_PORT; do
		_has "$T/compose.yml" "\${$_k" "the compose file reads \${$_k...} from .env"
	done
	_count "exactly one pid: host (the panel only)" "1" "$T/compose.yml" "    pid: host"
	_count "network_mode: host on all three services" "3" "$T/compose.yml" "    network_mode: host"
	_count "read_only: true on headscale" "1" "$T/compose.yml" "    read_only: true"
	_has "$T/compose.yml" "      - /var/run/headscale" "headscale gets a writable /var/run/headscale"
	_has "$T/compose.yml" "      - /tmp" "headscale gets a writable /tmp"
	_hasnt "$T/compose.yml" "security_opt:" "no security_opt key is generated"
	_hasnt "$T/compose.yml" "apparmor=" "no apparmor override is generated"
	_has "$T/compose.yml" "- /var/run/docker.sock:/var/run/docker.sock" "the panel gets the docker socket"
	_hasnt "$T/compose.yml" "docker.sock:/var/run/docker.sock:ro" "the docker socket is writable (the panel restarts the container)"
	_has "$T/compose.yml" "HEADPLANE_INTEGRATION__DOCKER__ENABLED=true" "docker integration is on"
	_has "$T/compose.yml" "HEADPLANE_INTEGRATION__DOCKER__CONTAINER_NAME=headscale" "docker integration targets the headscale container"
	_has "$T/compose.yml" "HEADPLANE_INTEGRATION__PROC__ENABLED=false" "process integration is off"
	_has "$T/compose.yml" "- \"\${BASE_DIR}/headscale:\${BASE_DIR}/headscale\"" "the Headscale directory is mounted at the same absolute path"
	_has "$T/compose.yml" "\${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml:ro" "headscale reads its config from the read-only copy"
	_has "$T/compose.yml" "container_name: headscale" "the headscale container keeps its fixed name"
	_has "$T/compose.yml" "container_name: headplaneCN" "the panel container is headplaneCN"
	_has "$T/compose.yml" "me.tale.headplane.target: \"headscale\"" "the headscale container carries the integration label"
	_hasnt "$T/compose.yml" "    ports:" "host networking needs no ports: section"
	_has "$T/compose.yml" "/admin/healthz" "the panel healthcheck probes its own bind address"
	_has "$T/compose.yml" "container_name: caddy" "the caddy container keeps its fixed name"
	_has "$T/compose.yml" "caddy/Caddyfile:/etc/caddy/Caddyfile:ro" "caddy reads the Caddyfile from the deployment directory"
	_has "$T/compose.yml" "CADDY_PORT=\${CADDY_PORT:-8444}" "caddy's port comes from .env"
	_has "$T/compose.yml" "\${IMAGE_PROXY-}headscale/headscale:" "the headscale image goes through IMAGE_PROXY"
	_has "$T/compose.yml" "\${IMAGE_PROXY-}ghcr.io/cgg888/headplanecn:" "the panel image goes through IMAGE_PROXY"
	_has "$T/compose.yml" "\${IMAGE_PROXY-}caddy:2-alpine" "the caddy image goes through IMAGE_PROXY"
	_has "$T/env" "IMAGE_PROXY=$DEFAULT_IMAGE_PROXY" ".env carries the default mirror prefix"
	_has "$T/env" "#IMAGE_PROXY=$DEFAULT_IMAGE_PROXY_ALT" ".env keeps the v4 alternative commented out"
	_hasnt "$T/compose.yml" "CADDY_IMAGE" "the old per-image CADDY_IMAGE key is gone"

	# A mirror typed into the image tags must not be applied a second time.
	_hs_saved="$HS_IMAGE_REPO"
	_hp_saved="$HP_IMAGE_REPO"
	HS_IMAGE_REPO="$IMAGE_PROXY$HS_IMAGE_REPO"
	HP_IMAGE_REPO="$IMAGE_PROXY$HP_IMAGE_REPO"
	build_compose_content >"$T/compose-prefixed.yml"
	_has "$T/compose-prefixed.yml" "\${IMAGE_PROXY-}headscale/headscale:" "a prefixed --headscale-tag is not prefixed twice"
	_has "$T/compose-prefixed.yml" "\${IMAGE_PROXY-}ghcr.io/cgg888/headplanecn:" "a prefixed --headplane-tag is not prefixed twice"
	_hasnt "$T/compose-prefixed.yml" "$IMAGE_PROXY\${IMAGE_PROXY-" "the mirror prefix is stripped from the repository"
	HS_IMAGE_REPO="$_hs_saved"
	HP_IMAGE_REPO="$_hp_saved"

	caddyfile_content >"$T/Caddyfile"
	_has "$T/Caddyfile" "auto_https off" "the Caddyfile never asks for a certificate"
	_has "$T/Caddyfile" "handle /admin*" "the Caddyfile keeps the panel's /admin prefix"
	_has "$T/Caddyfile" "reverse_proxy $PANEL_BIND:$PANEL_PORT" "the Caddyfile sends /admin to the panel"
	_has "$T/Caddyfile" "reverse_proxy 127.0.0.1:$DEFAULT_HS_PORT" "the Caddyfile sends everything else to Headscale"
	_has "$T/Caddyfile" "flush_interval -1" "the Caddyfile leaves long-lived connections unbuffered"

	hs_config_skeleton >"$T/hs-skeleton.yaml"
	_eq "the skeleton keeps the Headscale key path in the deployment directory" "$HS_DIR/noise_private.key" "$(yaml_get "$T/hs-skeleton.yaml" noise.private_key_path)"
	_eq "the skeleton keeps the DERP key path in the deployment directory" "$HS_DIR/derp_server_private.key" "$(yaml_get "$T/hs-skeleton.yaml" derp.server.private_key_path)"
	_eq "the skeleton keeps the database in the deployment directory" "$HS_DIR/db.sqlite" "$(yaml_get "$T/hs-skeleton.yaml" database.sqlite.path)"
	_eq "the skeleton keeps the unix socket in the deployment directory" "$HS_DIR/headscale.sock" "$(yaml_get "$T/hs-skeleton.yaml" unix_socket)"
	_eq "the skeleton keeps the DERP map under the deployment directory" "$DERP_MAP_CTR" "$(yaml_list "$T/hs-skeleton.yaml" derp.paths | head -n 1)"
	_hasnt "$T/hs-skeleton.yaml" "/var/lib/headscale/" "no path in the skeleton points into /var/lib/headscale"
	_hasnt "$T/hs-skeleton.yaml" "/etc/headscale/derp" "the skeleton never moves the DERP map into /etc/headscale"
	_eq "the skeleton listens on the Headscale port" "0.0.0.0:$DEFAULT_HS_PORT" "$(yaml_get "$T/hs-skeleton.yaml" listen_addr)"
	_eq "the skeleton keeps sqlite" "sqlite" "$(yaml_get "$T/hs-skeleton.yaml" database.type)"

	hp_config_skeleton >"$T/hp-skeleton.yaml"
	_eq "the panel skeleton binds the chosen address" "$PANEL_BIND" "$(yaml_get "$T/hp-skeleton.yaml" server.host)"
	_eq "the panel skeleton listens on the chosen port" "$PANEL_PORT" "$(yaml_get "$T/hp-skeleton.yaml" server.port)"
	_eq "the panel skeleton stores its data in the container" "/var/lib/headplane" "$(yaml_get "$T/hp-skeleton.yaml" server.data_path)"
	_eq "the panel skeleton talks to Headscale on localhost" "http://127.0.0.1:$DEFAULT_HS_PORT" "$(yaml_get "$T/hp-skeleton.yaml" headscale.url)"
	_eq "the panel skeleton reads the mounted config copy" "/etc/headscale/config.yaml" "$(yaml_get "$T/hp-skeleton.yaml" headscale.config_path)"
	_eq "the panel skeleton uses the Docker integration" "true" "$(yaml_get "$T/hp-skeleton.yaml" integration.docker.enabled)"
	_eq "the Docker integration targets the headscale container" "headscale" "$(yaml_get "$T/hp-skeleton.yaml" integration.docker.container_name)"
	_eq "the Docker integration looks for the integration label" "me.tale.headplane.target=headscale" "$(yaml_get "$T/hp-skeleton.yaml" integration.docker.container_label)"
	_eq "the process integration is off" "false" "$(yaml_get "$T/hp-skeleton.yaml" integration.proc.enabled)"

	# --- the panel writer patches an existing config to the same values -----
	local hp_saved="$HP_CONFIG" dry_saved="$DRY_RUN"
	HP_CONFIG="$T/hp-existing.yaml"
	DRY_RUN=1
	KEEP_COOKIE=0
	cat >"$HP_CONFIG" <<'YAML'
server:
  host: "0.0.0.0"
  port: 3000
  base_url: "http://old.example.com"
  cookie_secret: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
headscale:
  url: "http://headscale:8080"
  config_path: "/etc/headscale/config.yaml"
integration:
  proc:
    enabled: true
YAML
	write_headplane_config selftest >"$T/hp-writer.out" 2>"$T/hp-writer.err" || _bad "write_headplane_config must not fail"
	sed -n '/^--- would patch:/,/^--- end:/p' "$T/hp-writer.out" | sed '1d;$d' >"$T/hp-writer.yaml"
	_eq "the panel writer binds the chosen address" "$PANEL_BIND" "$(yaml_get "$T/hp-writer.yaml" server.host)"
	_eq "the panel writer replaces the old port" "$PANEL_PORT" "$(yaml_get "$T/hp-writer.yaml" server.port)"
	_eq "the panel writer stores its data in the container" "/var/lib/headplane" "$(yaml_get "$T/hp-writer.yaml" server.data_path)"
	_eq "the panel writer talks to Headscale on localhost" "http://127.0.0.1:$DEFAULT_HS_PORT" "$(yaml_get "$T/hp-writer.yaml" headscale.url)"
	_eq "the panel writer reads the mounted config copy" "/etc/headscale/config.yaml" "$(yaml_get "$T/hp-writer.yaml" headscale.config_path)"
	_eq "the panel writer turns the Docker integration on" "true" "$(yaml_get "$T/hp-writer.yaml" integration.docker.enabled)"
	_eq "the panel writer names the headscale container" "headscale" "$(yaml_get "$T/hp-writer.yaml" integration.docker.container_name)"
	_eq "the panel writer writes the integration label" "me.tale.headplane.target=headscale" "$(yaml_get "$T/hp-writer.yaml" integration.docker.container_label)"
	_eq "the panel writer uses the docker socket" "unix:///var/run/docker.sock" "$(yaml_get "$T/hp-writer.yaml" integration.docker.socket)"
	_eq "the panel writer turns the process integration off" "false" "$(yaml_get "$T/hp-writer.yaml" integration.proc.enabled)"
	_hasnt "$T/hp-writer.yaml" "3000" "the old panel port is gone"
	_hasnt "$T/hp-writer.yaml" "http://headscale:8080" "the old headscale.url is gone"
	_hasnt "$T/hp-writer.out" "$COOKIE_SECRET" "a dry run never prints the cookie secret in full"
	HP_CONFIG="$hp_saved"
	DRY_RUN="$dry_saved"

	# --- result ------------------------------------------------------------
	info ""
	if ((fails == 0)); then
		ok "self test passed: $checks checks, no failure"
		return 0
	fi
	err "self test failed: $fails of $checks checks"
	return 1
}

# -----------------------------------------------------------------------------
# Argument parsing
# -----------------------------------------------------------------------------
parse_args() {
	while (($# > 0)); do
		case "$1" in
		-h | --help)
			usage
			exit 0
			;;
		-n | --dry-run)
			DRY_RUN=1
			;;
		--self-test)
			SELF_TEST=1
			;;
		--defaults)
			USE_DEFAULTS=1
			;;
		--version)
			printf '%s %s\n' "$SCRIPT_NAME" "$SCRIPT_VERSION"
			exit 0
			;;
		--base-dir)
			[[ $# -ge 2 ]] || die "--base-dir needs a value"
			OPT_BASE_DIR="$2"
			shift
			;;
		--headscale-tag)
			[[ $# -ge 2 ]] || die "--headscale-tag needs a value"
			OPT_HS_IMAGE="$2"
			shift
			;;
		--headplane-tag)
			[[ $# -ge 2 ]] || die "--headplane-tag needs a value"
			OPT_HP_IMAGE="$2"
			shift
			;;
		--server-url)
			[[ $# -ge 2 ]] || die "--server-url needs a value"
			OPT_SERVER_URL="$2"
			shift
			;;
		--derp-host)
			[[ $# -ge 2 ]] || die "--derp-host needs a value"
			OPT_DERP_HOST="$2"
			shift
			;;
		--admin-host)
			[[ $# -ge 2 ]] || die "--admin-host needs a value"
			OPT_ADMIN_HOST="$2"
			shift
			;;
		--admin-port)
			[[ $# -ge 2 ]] || die "--admin-port needs a value"
			OPT_HP_PORT="$2"
			shift
			;;
		--admin-bind)
			[[ $# -ge 2 ]] || die "--admin-bind needs a value"
			OPT_ADMIN_BIND="$2"
			shift
			;;
		--caddy-port)
			[[ $# -ge 2 ]] || die "--caddy-port needs a value"
			OPT_CADDY_PORT="$2"
			shift
			;;
		--image-proxy)
			[[ $# -ge 2 ]] || die "--image-proxy needs a value"
			OPT_IMAGE_PROXY="$2"
			shift
			;;
		--stun-port)
			[[ $# -ge 2 ]] || die "--stun-port needs a value"
			OPT_STUN_PORT="$2"
			shift
			;;
		--tz)
			[[ $# -ge 2 ]] || die "--tz needs a value"
			OPT_TZ="$2"
			shift
			;;
		--region-id)
			[[ $# -ge 2 ]] || die "--region-id needs a value"
			OPT_REGION_ID="$2"
			shift
			;;
		--)
			shift
			break
			;;
		*)
			err "unknown option: $1"
			err "run with --help to see all flags"
			exit 2
			;;
		esac
		shift
	done
	return 0
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
	parse_args "$@"

	RUN_TS="$(date '+%Y-%m-%d %H:%M:%S %z')"
	RUN_STAMP="$(date '+%Y%m%d-%H%M%S')"
	TMP_ROOT="$(mktemp -d 2>/dev/null)" || die "cannot create a private temporary directory"
	TMP_DIRS+=("$TMP_ROOT")
	trap 'cleanup' EXIT
	trap 'exit 130' INT
	trap 'exit 143' TERM

	if ((SELF_TEST)); then
		if self_test; then
			return 0
		fi
		return 1
	fi

	head2 "$SCRIPT_NAME $SCRIPT_VERSION  ($RUN_TS)"
	info "two-container deployment (Headscale + HeadplaneCN); see docs/install/dual-image.md"
	info "this script never deletes or moves your data and never runs git."
	info ""

	if ((DRY_RUN == 0)); then
		if confirm "Preview only, as a dry run (nothing will be written or started)?" n; then
			DRY_RUN=1
		fi
	fi
	if ((DRY_RUN)); then
		info "mode: DRY RUN - nothing is written outside $TMP_ROOT and nothing is started"
	else
		info "mode: APPLY - files are written after the final confirmation"
	fi
	info ""

	preflight
	step_base_dir
	step_images
	step_urls
	step_network
	step_secrets
	step_derp
	step_migration

	print_plan

	if ((DRY_RUN == 0)); then
		if ! confirm "Write these files now?" y; then
			die "aborted by the operator; nothing was written"
		fi

		head2 "Step 8/9  Writing"
		act_mkdir "$BASE_DIR" 755
		act_mkdir "$HP_DATA" 700
		act_mkdir "$HS_DIR" 755
		act_mkdir "$DERP_MAP_DIR" 755
		act_mkdir "$BACKUP_DIR" 700
		act_mkdir "$CADDY_DIR" 755
		act_mkdir "$CADDY_DIR/data" 755
		act_mkdir "$CADDY_DIR/config" 755

		if ((MIGRATE_ACTIVE)); then
			run_migration "$RUN_STAMP"
		fi

		dim "  --- .env ---"
		stage_file "$ENV_FILE" 600 < <(env_content)

		dim "  --- Headscale configuration ---"
		write_headscale_config "$RUN_STAMP"

		dim "  --- HeadplaneCN configuration ---"
		write_headplane_config "$RUN_STAMP"

		if [[ ! -e $DERP_MAP_HOST ]]; then
			dim "  --- DERP mirror map (placeholder) ---"
			stage_file "$DERP_MAP_HOST" 644 <<'YAML'
# Placeholder written by dual-image-install.sh.
# Fill it in from the panel (Settings -> Headscale -> DERP map) or let the
# DERP region mirror write it.  Headscale refuses to start when a derp.paths
# entry names a file it cannot read.
regions: {}
YAML
		else
			dim "  keeping the existing DERP map: $DERP_MAP_HOST"
		fi

		dim "  --- compose file ---"
		if [[ -e $COMPOSE_FILE ]]; then
			act_backup_file "$COMPOSE_FILE" "$RUN_STAMP"
		fi
		build_compose_content | stage_file "$COMPOSE_FILE" 644

		dim "  --- caddy/Caddyfile (the /admin path split) ---"
		if [[ -e $CADDY_FILE ]]; then
			act_backup_file "$CADDY_FILE" "$RUN_STAMP"
		fi
		caddyfile_content | stage_file "$CADDY_FILE" 644

		dim "  --- permissions ---"
		chmod 600 "$ENV_FILE" 2>/dev/null || warn "could not chmod 600 $ENV_FILE"
		if [[ -e $HS_CONFIG ]]; then
			chmod 600 "$HS_CONFIG" 2>/dev/null || warn "could not chmod 600 $HS_CONFIG"
		fi
		local _key
		for _key in noise_private.key derp_server_private.key private.key; do
			if [[ -e $HS_DIR/$_key ]]; then
				chmod 600 "$HS_DIR/$_key" 2>/dev/null || warn "could not chmod 600 $HS_DIR/$_key"
			fi
		done
		if ((ROOT_UID)); then
			if v_recursive_chown_target "$HS_DIR"; then
				chown -R "$HEADSCALE_UID:$HEADSCALE_GID" "$HS_DIR" || warn "could not chown -R $HS_DIR"
				ok "  $HS_DIR and everything in it now belong to $HEADSCALE_UID:$HEADSCALE_GID"
			fi
		else
			dim "  not root: if the containers cannot write $HS_DIR, run this yourself:"
			dim "    chown -R $HEADSCALE_UID:$HEADSCALE_GID $HS_DIR"
		fi
		if have docker && docker compose version >/dev/null 2>&1; then
			if (cd "$BASE_DIR" && docker compose config -q 2>/dev/null); then
				ok "  docker compose accepted the generated files"
			else
				warn "docker compose config reported a problem; run 'cd $BASE_DIR && docker compose config' to see it"
			fi
		fi

		head2 "Step 9/9  Start and verify"
		if confirm "Start the stack now (docker compose up -d)?" n; then
			START_NOW=1
			if (cd "$BASE_DIR" && docker compose up -d); then
				ok "containers started"
				run_verification
			else
				warn "'docker compose up -d' failed; fix the problem above and run it again by hand"
			fi
		else
			dim "  not started. When you are ready:"
			dim "    cd $BASE_DIR && docker compose up -d"
		fi
	fi

	print_summary

	if ((DRY_RUN)); then
		info ""
		ok "DRY RUN finished: nothing was written outside $TMP_ROOT and no container was started."
		info "re-run the same command without --dry-run to write these files."
	fi
	return 0
}

main "$@"
