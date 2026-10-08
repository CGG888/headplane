---
title: Installation
description: Get started with HeadplaneCN.
outline: [2, 3]
---

# Installation

HeadplaneCN is designed to be deployed within several different environments to
ensure that it can seamlessly integrate into your existing infrastructure. First
set up your configuration file and then pick the installation method that best
suits your needs.

## Configuration

HeadplaneCN requires a configuration file to operate. A
[sample file](https://github.com/CGG888/headplaneCN/blob/main/config.example.yaml)
is available to use as a starting point. Some of the important fields include:

| Field                      | Description                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **`headscale.url`**        | Point to your Headscale server (e.g., `http://headscale.example.com` or `http://headscale:8080` in Docker). |
| **`server.cookie_secret`** | Used to encrypt cookies. You can generate a random string using a command like `openssl rand -base64 24`.   |
| **`server.data_path`**     | Just a path to keep in mind, especially if you're using Docker.                                             |

The configuration file is rather complicated and has many more options. Refer to
the [Configuration](../configuration/index.md) guide for a detailed explanation of all
the available options, as well as guidance on securely setting up your values
through secret path options and environment variables.

## Deployment Methods

HeadplaneCN can be deployed in several different ways, each with its own set of
advantages and trade-offs. Choose the method that best fits your needs:

### [Docker](./docker.md): Fast and easy deployment using Docker

- Recommended for most users due to its simplicity and ease of use.
- Allows for advanced features like network management and remote web SSH.
- Requires Docker and Docker Compose to be installed.

---

### [Native Mode](./native-mode.md): Direct installation on a server

- Suitable for users who prefer not to use Docker.
- Allows for advanced features like network management and remote web SSH.
- Requires manual setup of dependencies and environment.

---

### [Limited Mode](./limited-mode.md): Quick and easy deployment with minimal features

- Ideal for testing or simple environments and not intended for production use.
- Lacks any advanced functionality or integrations such as network management
  or remote web SSH.

---

### [Dual-image deployment](./dual-image.md): Headscale and HeadplaneCN as two containers

- The NAS shape that hands Headscale to Docker as well: both containers use host
  networking, and Headscale's data directory is mounted at the **same absolute
  path** inside the container, so no absolute path in its configuration changes.
- Uses the Docker integration (saving configuration restarts the Headscale
  container), so no `pid: host` + AppArmor proc setup is needed.
- Includes `.env`, the complete compose file and both configuration files,
  migration in **both directions** (fnOS native ⇄ dual image), reverse proxy
  notes and a verification checklist.

---

### [fnOS (飞牛)](./fnos.md): Deployment on an fnOS NAS

- For NAS setups that run Headscale natively from an fnOS app source and
  HeadplaneCN in Docker.
- Includes ready-to-use configuration files, reverse proxy notes and
  per-symptom troubleshooting.
