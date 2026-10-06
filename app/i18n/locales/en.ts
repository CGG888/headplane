/**
 * The English catalog is the source of truth for both the key space and the
 * fallback text. Keep it structurally in sync with the other locales — the type
 * checker enforces this via `satisfies Catalog` in each translation file.
 */
const en = {
  meta: {
    description: "A frontend for the headscale coordination server",
  },
  language: {
    label: "Language",
    en: "English",
    "zh-Hans": "简体中文",
    "zh-Hant": "繁體中文",
  },
  common: {
    retry: "Retry",
    learnMore: "Learn more",
    dismiss: "Dismiss",
    close: "Close",
    cancel: "Cancel",
    confirm: "Confirm",
    clickToCopy: "Click to copy",
    copyFailed: "Copy failed. Please copy the text manually.",
    copied: "Copied to clipboard",
    copiedName: "Copied {name} to clipboard",
    noResults: "No results found.",
    increment: "Increment",
    decrement: "Decrement",
    online: "Online",
    offline: "Offline",
  },
  header: {
    logoAlt: "HeadplaneCN logo",
    brand: "HeadplaneCN Console",
    tabs: {
      overview: "Overview",
      machines: "Machines",
      users: "Users",
      policy: "Access Control",
      dns: "DNS",
      settings: "Settings",
    },
    help: {
      docs: "Docs",
      headscale: "Headscale",
      download: "Download",
    },
    colorScheme: {
      system: "System",
      light: "Light",
      dark: "Dark",
    },
    apiKey: "API Key",
    liveUpdates: {
      label: "Live updates",
      on: "On",
      off: "Off",
    },
    logout: "Logout",
  },
  footer: {
    about:
      "Headplane is free and open-source software (upstream: {upstream}) — please use it and support its development. This fork is maintained at {fork}.",
    upstreamLink: "the upstream project",
    forkLink: "CGG888/headplaneCN",
    sponsorLink: "Sponsor this fork",
    debug: "Debug",
    showServerUrl: "Show server URL",
    hideServerUrl: "Hide server URL",
  },
  app: {
    unhealthy: {
      title: "Headscale Unreachable",
      body: "Unable to connect to the Headscale server. Data shown may be stale and changes cannot be saved until the connection is restored.",
    },
  },
  overview: {
    title: "Overview",
    intro:
      "What this HeadplaneCN instance runs, how Headscale is configured, and whether anything needs attention. Read-only.",
    unavailable: "—",
    unavailableReason: "— ({reason})",
    cards: {
      manage: "Manage cards",
      hideCard: "Hide this card",
      body: "Cards you hide stay listed here so you can bring them back at any time. A card that is an alert in its own right always stays visible.",
      hiddenState: "Hidden",
      protectedState: "Always visible",
      healthHideableNote:
        "Hiding the health summary hides the summary only: a failing check is still delivered through the notification webhooks.",
      restoreDefault: "Restore defaults",
    },
    sections: {
      versions: "Versions",
      derp: "DERP",
      service: "Service",
      counts: "Counts",
      health: "Health",
    },
    status: {
      enabled: "Enabled",
      disabled: "Disabled",
      configured: "Configured",
      derived: "From config and agent reports",
      reachable: "Reachable",
      unreachable: "Unreachable",
      healthy: "Healthy",
      attention: "Needs attention",
      on: "On",
      off: "Off",
      never: "Never",
      updateAvailable: "Update available",
      upToDate: "Up to date",
      releaseUnknown: "No release information",
    },
    reason: {
      agentDisabled: "the HeadplaneCN Agent is not enabled",
      apiUnavailable: "the Headscale API could not be read",
      configUnreadable: "the Headscale configuration file is not readable",
      notConfigured: "not configured",
      notReported: "not reported",
      unsupported: "not supported by this Headscale version",
    },
    versions: {
      headplaneTitle: "HeadplaneCN",
      headplaneBody: "This HeadplaneCN build, and the release it can see.",
      headscaleTitle: "Headscale",
      headscaleBody: "The Headscale server that HeadplaneCN talks to.",
      agentTitle: "HeadplaneCN Agent",
      agentBody: "The co-located agent that reports details the Headscale API omits.",
      running: "Running version",
      latest: "Latest release",
      updateNote: "{latest} is available; {current} is running.",
      agentVersion: "Reported version",
      agentLastSync: "Last sync",
      agentNodes: "Nodes reported",
      agentError: "Last sync error",
      agentDisabledBody:
        "The HeadplaneCN Agent is not running, so node details are not collected. Enable it under Settings → Agent.",
    },
    derp: {
      regionTitle: "Embedded Region",
      regionBody: "The embedded relay region, and where Headscale's DERP map comes from.",
      publicTitle: "Relay Addresses & STUN",
      publicBody: "The address clients dial for the relay, and the IPv4/IPv6 addresses behind it.",
      region: "Region",
      relaySource: "Relay sources",
      relaySourceNote: "Based on derp.server.enabled and derp.urls.",
      relaySourceEmbeddedOnly: "Embedded server only",
      relaySourceEmbeddedAndMap: "Embedded server and DERP map",
      relaySourceMapOnly: "DERP map only",
      relaySourceNone: "None",
      urls: "DERP map URLs",
      paths: "Local DERP map files",
      countConfigured: "{count} configured",
      countFiles: "{count} files",
      none: "None",
      publicUnavailable: "server_url is not a usable http(s) URL",
      relayClientAddress: "Client connect address",
      syncChangedAt: "Advertised addresses updated {at}.",
      syncUnchangedAt: "Last address check {at}: no change.",
      syncSkippedAt: "Last address check {at}: nothing to update.",
      syncFailedAt: "Last address check {at} failed.",
      syncNever: "No address check has run yet.",
      relaySetup:
        "The relay address, the echo probe and the address sync are set up in Headscale settings. {link}",
      relaySetupLink: "Set this up",
      relayIpv4: "IPv4",
      relayIpv6: "IPv6",
      relayDeclaredMarker: "derp.server",
      relayVerdictMatch: "matches the address derp.server declares",
      relayVerdictMismatch:
        "derp.server declares {address}, which this hostname does not resolve to",
      relayVerdictNoRecords:
        "derp.server declares {address}, but this hostname has no record of that type",
      relayVerdictUnavailable: "not checked: the DNS lookup did not complete",
      relayVerdictHostMissing: "not checked: server_url names no usable host",
      relayVerdictLiteral: "this endpoint is already an IP address, so nothing is resolved",
      relayFixIpv4:
        "point the A record at this machine's current address, or clear derp.server.ipv4",
      relayFixIpv6: "add an AAAA record for this hostname, or accept IPv4-only",
      relayFixIpv6NoRecords:
        "a host resolver can answer with no AAAA even when the name has one: compare `dig @1.1.1.1 +short AAAA {host}` with `dig +short AAAA {host}`, and if the first answers, point this host's DNS at a resolver that returns AAAA. The negative answer is cached for five minutes; restart HeadplaneCN to clear it",
      relayReasonNoRecords: "the DNS lookup returned no records",
      relayReasonTimeout: "the DNS lookup timed out",
      relayReasonResolverError: "the DNS lookup failed",
      relayReasonHostMissing: "server_url names no host",
      relayReasonInvalidHost: "the hostname is not a usable DNS name",
      relayReasonUnavailable: "not resolved",
      relaySourceHost: "Host",
      relaySourceDnsUnverified: "DNS-unverified",
      relaySourceEcho: "Internet (echo)",
      ipv6EchoMatches: "The internet sees {address}, and this machine holds it.",
      ipv6EchoForwarded:
        "The internet sees {address}, which no interface on this machine holds: clients reach it through NAT66 or a router that forwards another address.",
      ipv6ContradictionTitle: "The declared address is not what clients reach",
      ipv6ContradictionEcho:
        "derp.server.ipv6 declares {declared}, but the internet sees {detected}.",
      ipv6ContradictionHost:
        "derp.server.ipv6 declares {declared}, but this machine's own address is {detected}.",
      ipv6ContradictionCopy: "Copy the address to use",
      ipv6ReasonOsUnreadable: "The interface list could not be read.",
      ipv6ReasonProcUnreadable:
        "/proc/net/if_inet6 could not be read, so a temporary address cannot be told from a stable one.",
      ipv6ReasonSysUnreadable:
        "/sys/class/net could not be read, so a real NIC cannot be told from a virtual interface.",
      ipv6ReasonEchoDisabled: "The external IPv6 echo is off.",
      ipv6ReasonEchoTimeout: "The external IPv6 echo did not answer in time.",
      ipv6ReasonEchoUnreachable: "The external IPv6 echo could not be reached.",
      ipv6ReasonEchoInvalid: "The external IPv6 echo returned no usable IPv6 address.",
      ipv6NoneBody:
        "This machine has no public IPv6 address. Declare one in derp.server.ipv6, or fix the domain's DNS.",
      ipv6Alternates: "Other addresses on this machine: {addresses}",
      ipv6MismatchTitle: "The domain points elsewhere",
      ipv6MismatchBody:
        "The domain's AAAA answer is {dns}, but this machine holds {host}. The record may point at another machine, or be a temporary privacy address — publish the host address instead.",
      ipv6HostCopy: "Copy host address",
      ipv6UnverifiedNote:
        "The domain's DNS answer, which HeadplaneCN could not check against this machine's own addresses.",
      stun: "STUN listen address",
      ipv6StunTitle: "STUN listens on IPv4 only",
      ipv6StunBody:
        "derp.server.ipv6 is set to {ipv6}, but STUN listens on {stun}. Go binds an IPv4 address such as 0.0.0.0 as IPv4 only, so a client without an IPv4 stack cannot reach STUN. Use a dual-stack or IPv6 listen address such as [::]:3478.",
      nodesTitle: "DERP nodes",
      nodesBody: "Every DERP node this configuration describes, one row per source.",
      nodesSummary: "{served} served here · {total} known",
      nodesCount: "{count} nodes",
      nodesMore: "+{count} more nodes",
      nodesNotServed: "not served here",
      nodesSourcesLabel: "Node sources",
      nodesSourceEmbedded: "Embedded relay",
      nodesSourceEmbeddedHint: "The relay derp.server embeds; clients receive it.",
      nodesSourceLocal: "Local map files",
      nodesSourceLocalHint: "The maps listed in derp.paths; clients receive their nodes.",
      nodesSourceMirror: "Official filter",
      nodesSourceMirrorHint:
        "The file the official region filter maintains; clients receive it only once derp.paths lists it.",
      nodesSourceOfficial: "Official upstream",
      nodesSourceOfficialHint: "The regions derp.urls adds that this machine does not serve.",
      nodesEmbeddedOff: "The embedded server is off.",
      nodesLocalNone: "Nothing in derp.paths.",
      nodesMirrorOff: "The region filter is off.",
      nodesMirrorUnlisted: "Not in derp.paths yet.",
      nodesOfficialNoUrls: "Nothing in derp.urls.",
      nodesOfficialCovered: "Already served above.",
      nodesUnreadable: "Unreadable.",
      nodesEmpty: "No nodes.",
      nodesFileUnreadable:
        "HeadplaneCN cannot read {path}: the map directory needs to be mounted read-write at the same absolute path inside the container.",
      nodesFileInvalid: "{path} is not a DERP map HeadplaneCN can read.",
      nodesFileEmpty: "{path} describes no regions.",
      nodesUrlUnreadable: "The map at {url} could not be read, so its nodes are missing here.",
      nodesUrlEmpty: "The map at {url} describes no regions.",
      nodesAddLink: "Add a node",
    },
    service: {
      title: "Headscale Server",
      serverBody: "How HeadplaneCN reaches Headscale, and the access-control mode in force.",
      url: "URL",
      baseDomain: "Base domain",
      policyMode: "Policy mode",
      policyModeFile: "File",
      policyModeDatabase: "Database",
      dnsTitle: "DNS & Policy",
      dnsBody: "The name resolution settings Headscale hands to tailnet clients.",
      magicDns: "Magic DNS",
      overrideDns: "Override local DNS",
      extraRecords: "Extra-records file",
      extraRecordsNote: "dns.extra_records_path in Headscale's configuration file.",
      metricsTitle: "Metrics & Proxies",
      metricsBody: "Whether Headscale's metrics endpoint answers, and which proxies it trusts.",
      metricsListener: "Metrics listener",
      metricsEndpoint: "Metrics endpoint",
      metricsOk: "Reachable",
      metricsUnreachable: "Unreachable",
      metricsDisabled: "Not enabled",
      metricsInvalid: "Invalid listen address",
      metricsUnknown: "Unknown",
      trustedProxies: "Trusted proxies",
      trustedProxiesValue: "{count} entries",
    },
    counts: {
      tailnetTitle: "Tailnet",
      tailnetBody: "What Headscale reports about the tailnet right now.",
      headplaneTitle: "HeadplaneCN Data",
      headplaneBody: "The records HeadplaneCN keeps for itself on this host.",
      nodes: "Nodes",
      nodesSplit: "{online} online · {offline} offline",
      nodesValue: "{total} ({online} online, {offline} offline)",
      users: "Users",
      preAuthKeys: "Pre-auth keys",
      apiKeys: "API keys",
      audit: "Operation log entries",
      snapshots: "Snapshots",
      snapshotsSize: "Size: {size}",
      snapshotsValue: "{count} · {size}",
    },
    history: {
      title: "Node availability",
      body: "How many nodes were online over the last 7 days, sampled every few minutes.",
      summary: "Sampled {covered} of {total} periods · peak {peak} online",
      collectingSince: "Collecting since {at}",
      legendOnline: "Online",
      legendOffline: "Offline",
      legendUnknown: "Not sampled",
      noData: "availability history has not been collected yet",
    },
    health: {
      title: "Health Summary",
      body: "Configuration checks and diagnostics, counted by result.",
      configChecks: "Configuration checks",
      diagnostics: "Diagnostics",
      tally: "{pass} pass · {warning} warning · {fail} fail",
      passCount: "{count} pass",
      warningCount: "{count} warning",
      failCount: "{count} fail",
      details: "System Status",
      detailsBody: "Open the {link} for full check details, metrics and process control.",
    },
  },
  machines: {
    common: {
      tagOwned: "Tag-owned",
      unknown: "Unknown",
      connected: "Connected",
      never: "Never",
      yes: "Yes",
      no: "No",
      ownerLabel: "Owner",
      selectUser: "Select a user",
    },
    filters: {
      user: "User",
      tag: "Tag",
      status: "Status",
      route: "Route",
      online: "Online",
      offline: "Offline",
      expired: "Expired",
      exitNode: "Exit node",
      subnetRouter: "Subnet router",
      clearFilter: "Clear filter",
      clearFilters: "Clear filters",
    },
    menu: {
      ssh: "SSH",
      settings: "Machine Settings",
      editName: "Edit machine name",
      enableKeyExpiry: "Enable key expiry",
      disableKeyExpiry: "Disable key expiry",
      editRoutes: "Edit route settings",
      editTags: "Edit ACL tags",
      changeOwner: "Change owner",
      expire: "Expire",
      remove: "Remove",
    },
    row: {
      copiedIp: "Copied IP address to clipboard",
      copyFailed: "Copy failed. Please copy the address manually.",
    },
    list: {
      title: "Machines",
      subtitle: "Manage the devices connected to your Tailnet.",
      searchLabel: "Search machines",
      searchPlaceholder: "Search by name or IP address...",
      clearSearch: "Clear search",
      showing: "Showing {count} of {total} machines",
      total: {
        one: "{count} machine",
        other: "{count} machines",
      },
      columnName: "Name",
      columnAddresses: "Addresses",
      columnVersion: "Version",
      columnLastSeen: "Last Seen",
      sortByName: "Sort by name",
      sortByIp: "Sort by IP address",
      sortByVersion: "Sort by version",
      sortByLastSeen: "Sort by last seen",
      sort: "Sort",
      magicDnsTooltip:
        "Since MagicDNS is enabled, you can access devices based on their name and also at {code}",
      actions: "Actions",
      empty: "No machines match the current filters",
      emptyNone: "No machines yet",
      emptyNoneBody: "Register a device with a pre-auth key and it will show up here.",
      emptyFilteredBody: "Adjust the search or filters to see more machines.",
      refresh: {
        label: "Auto-refresh",
        enable: "Turn on auto-refresh",
        disable: "Turn off auto-refresh",
        now: "Refresh now",
        updatedNow: "Updated just now",
        updatedSecondsAgo: "Updated {count}s ago",
        updatedMinutesAgo: "Updated {count}m ago",
        updatedHoursAgo: "Updated {count}h ago",
      },
    },
    detail: {
      allMachines: "All Machines",
      tagsTitle: "ACL tags",
      dangerTitle: "Danger zone",
      managedBy: "Managed by",
      managedByTooltip: "By default, a machine’s permissions match its creator’s.",
      status: "Status",
      routingTitle: "Subnets & Routing",
      routingBody: "Subnets let you expose physical network routes onto Tailscale.",
      review: "Review",
      approved: "Approved",
      approvedTooltip: "Traffic to these routes are being routed through this machine.",
      awaitingApproval: "Awaiting Approval",
      awaitingApprovalTooltip:
        "This machine is advertising these routes, but they must be approved before traffic will be routed to them.",
      exitNode: "Exit Node",
      exitNodeTooltip: "Whether this machine can act as an exit node for your tailnet.",
      allowed: "Allowed",
      edit: "Edit",
      availability: {
        title: "Availability",
        body: "Whether this machine was online over the last 24 hours, sampled every few minutes.",
        uptime: "{percent}% uptime",
        noDataChip: "No data",
        collectingSince: "Collecting since {at}",
        legendOnline: "Online",
        legendOffline: "Offline",
        legendUnknown: "Not sampled",
        noData: "Availability has not been recorded for this machine yet.",
      },
      detailsTitle: "Machine Details",
      detailsBody: "Information about this machine’s network. Used to debug connection issues.",
      creator: "Creator",
      machineName: "Machine name",
      osHostname: "OS hostname",
      osHostnameTooltip:
        "OS hostname is published by the machine’s operating system and is used as the default name for the machine.",
      os: "OS",
      tailscaleVersion: "Tailscale version",
      id: "ID",
      idTooltip: "ID for this machine. Used in the Headscale API.",
      nodeKey: "Node key",
      nodeKeyTooltip: "Public key which uniquely identifies this machine.",
      created: "Created",
      lastSeen: "Last Seen",
      keyExpiry: "Key expiry",
      domain: "Domain",
      addresses: "Addresses",
      tailscaleIpv4: "Tailscale IPv4",
      tailscaleIpv4Tooltip:
        "This machine’s IPv4 address within your tailnet (your private Tailscale network).",
      tailscaleIpv6: "Tailscale IPv6",
      tailscaleIpv6Tooltip:
        "This machine’s IPv6 address within your tailnet (your private Tailscale network). Connections within your tailnet support IPv6 even if your ISP does not.",
      shortDomain: "Short domain",
      shortDomainTooltip:
        "Users of your tailnet can use this DNS short name to access this machine.",
      fullDomain: "Full domain",
      fullDomainTooltip: "Users of your tailnet can use this DNS name to access this machine.",
      endpoints: "Endpoints",
      clientConnectivity: "Client Connectivity",
      varies: "Varies",
      variesTooltip:
        "Reported by the machine itself: whether it is behind a difficult NAT that varies its IP address depending on the destination.",
      hairpinning: "Hairpinning",
      hairpinningTooltip:
        "Reported by the machine itself: whether it needs to traverse NATs with hairpinning.",
      ipv6: "IPv6",
      ipv6Tooltip:
        "Reported by the machine itself in Tailscale's connectivity self-test: whether that machine has working IPv6 on its own network. It says nothing about Headscale, so it cannot be fixed here. If it says No, check that machine's network: whether the router or ISP gives it a global IPv6 address, whether it has a default IPv6 route, whether IPv6 is enabled on its interface, whether the firewall allows it, or whether the network is IPv4-only. Tailscale IPv6 addresses inside your tailnet work either way.",
      udp: "UDP",
      udpTooltip:
        "Reported by the machine itself: whether it could send UDP to Tailscale's endpoint probe. Direct connections use UDP, so a machine that fails this falls back to a DERP relay.",
      upnp: "UPnP",
      upnpTooltip:
        "Reported by the machine itself: whether it obtained a port mapping from the router with UPnP. A mapping makes direct connections easier.",
      pcp: "PCP",
      pcpTooltip:
        "Reported by the machine itself: whether it obtained a port mapping from the router with PCP.",
      natPmp: "NAT-PMP",
      natPmpTooltip:
        "Reported by the machine itself: whether it obtained a port mapping from the router with NAT-PMP.",
      derp: {
        title: "DERP Relays",
        body: "The relay address, the embedded DERP region, and the relays this machine uses — per-machine data comes from the HeadplaneCN Agent.",
        relayAddressTitle: "Relay clients reach",
        relayIpv4: "IPv4",
        relayIpv6: "IPv6",
        relayDeclaredMarker: "derp.server",
        relayVerdictMatch: "matches the address derp.server declares",
        relayVerdictMismatch:
          "derp.server declares {address}, which this hostname does not resolve to",
        relayVerdictNoRecords:
          "derp.server declares {address}, but this hostname has no record of that type",
        relayVerdictUnavailable: "not checked: the DNS lookup did not complete",
        relayVerdictHostMissing: "not checked: server_url names no usable host",
        relayVerdictLiteral: "this endpoint is already an IP address, so nothing is resolved",
        relayResolvedUnavailable: "not resolved",
        relayReasonNoRecords: "the DNS lookup returned no records",
        relayReasonTimeout: "the DNS lookup timed out",
        relayReasonResolverError: "the DNS lookup failed",
        relayReasonHostMissing: "server_url names no host",
        relayReasonInvalidHost: "the hostname is not a usable DNS name",
        relayUnavailable:
          "Headscale's server_url could not be read, so the relay clients reach is unknown.",
        relayMachineTitle: "Relays this machine uses",
        relayInUse: "In use",
        relaySourceEmbedded: "Embedded relay",
        relaySourceLocal: "Local map files",
        relaySourceMirror: "Official filter",
        relaySourceOfficial: "Official upstream",
        agentRequired:
          "Live relay data needs the HeadplaneCN Agent. Enable the agent so HeadplaneCN can read this machine's home region, preferred region, and DERP latency.",
        empty: "This machine has not reported DERP relay information yet.",
        homeRegion: "Home region",
        preferredRegion: "Preferred region",
        latency: "Latency by region",
        latencyMore: "{count} more regions were measured; only the fastest are shown.",
        idsOnly:
          "Regions that neither the configured DERP maps nor a manual name describe are shown by ID.",
        embeddedMarker: "embedded DERP",
        embeddedEnabled: "Headscale's embedded DERP server is enabled and serves region {region}.",
        embeddedDisabled:
          "Headscale's embedded DERP server is disabled, so this machine relays through external DERP regions.",
        embeddedSettingsLink: "Configure DERP relays",
        unknown: "Unknown",
        noLatency: "No data",
      },
    },
    new: {
      registerTitle: "Register Machine Key",
      registerBody: "The machine key is given when you run the following command on your device:",
      machineKeyLabel: "Machine Key",
      machineKeyDescription: "Paste the registration URL or full key shown by tailscale up.",
      machineKeyInvalid:
        "Paste the registration URL or full hskey-authreq-... key from tailscale up.",
      addDevice: "Add Device",
      generatePreAuth: "Generate Pre-auth Key",
    },
    rename: {
      title: "Edit machine name for {name}",
      body: "This name is shown in the admin panel, in Tailscale clients, and used when generating MagicDNS names.",
      nameLabel: "Machine name",
      invalid:
        "Use a valid DNS label: lowercase letters, numbers, and hyphens only. It must start and end with a letter or number.",
      hostnameChanged:
        "This machine will be accessible by the hostname {newName}. The hostname {oldName} will no longer point to this machine.",
      hostnameCurrent: "This machine is accessible by the hostname {name}.",
    },
    move: {
      title: "Change the owner of {name}",
      body: "The owner of the machine is the user associated with it.",
    },
    remove: {
      title: "Remove {name}",
      body: "This machine will be permanently removed from your network. To re-add it, you will need to reauthenticate to your tailnet from the device.",
    },
    expire: {
      title: "Expire {name}",
      body: "Key expiry controls when this machine must re-authenticate to stay connected to your Tailnet.",
      modeLabel: "Key expiry",
      modeNever: "Never expires",
      modeNeverBody: "This machine will never need to re-authenticate.",
      modeDefault: "Default expiry",
      modeDefaultBody: "Use Headscale's default behaviour and expire the key now.",
      modeCustom: "Specific date and time",
      modeCustomBody: "Choose exactly when this machine's key expires.",
      dateLabel: "Expiration date",
      dateDescription: "The machine must re-authenticate after this date to stay connected.",
      errors: {
        invalidDate: "Enter a valid date and time.",
        pastDate: "The expiration must be in the future.",
      },
    },
    routes: {
      title: "Edit route settings of {name}",
      subnetTitle: "Subnet routes",
      subnetBody:
        "Connect to devices you can't install Tailscale on by advertising IP ranges as subnet routes.",
      subnetEmpty: "No routes are advertised by this machine",
      exitTitle: "Exit nodes",
      exitBody: "Allow your network to route internet traffic through this machine.",
      exitEmpty: "This machine is not an exit node",
      useAsExitNode: "Use as exit node",
      enabled: "Enabled",
    },
    tags: {
      title: "Edit ACL tags for {name}",
      description:
        "ACL tags can be used to reference machines in your ACL policies. See the {link} for more information.",
      tailscaleDocs: "Tailscale documentation",
      empty: "No tags are set on this machine",
      addLabel: "Add a tag",
      tagLabel: "Tag",
      placeholder: "tag:example",
      undeclared: {
        one: "{tags} is not declared under {tagOwners} in your policy, so no rule will match it. Declare it in {accessControl}.",
        other:
          "{tags} are not declared under {tagOwners} in your policy, so no rule will match them. Declare them in {accessControl}.",
      },
      undeclaredHint:
        "Not seeing the tags you expect? Tags need to be defined in your access control policy before they can be assigned to machines.",
      notInPolicy:
        "One or more tags are not defined in your ACL policy. Please add them to your policy before assigning them to a machine.",
    },
    bulk: {
      selected: {
        one: "{count} machine selected",
        other: "{count} machines selected",
      },
      selectAll: "Select all visible machines",
      selectRow: "Select {name}",
      clearSelection: "Clear selection",
      actionsLabel: "Bulk actions",
      setTags: "Set tags",
      setExpiry: "Set expiry",
      changeOwner: "Change owner",
      delete: "Delete",
      result: {
        all: {
          one: "{count} machine updated",
          other: "{count} machines updated",
        },
        partial: "{updated} machines updated, {failed} failed",
      },
      errors: {
        noMachinesSelected: "Select at least one machine before running a bulk action.",
        tooManyMachines: "Too many machines were selected for a single action.",
        missingTags: "Enter at least one tag.",
        missingUserId: "Select a user.",
        ownerUnsupported:
          "Changing the owner of a machine is not supported by this Headscale version.",
        unknown: "The action failed. Please try again.",
      },
      tags: {
        title: {
          one: "Set tags on {count} machine",
          other: "Set tags on {count} machines",
        },
        description:
          "The tags below replace the existing tags on every selected machine. See the {link} for more information.",
        replaceNotice:
          "Tags are replaced, not merged. Applying an empty list removes all tags from the selected machines.",
        empty: "No tags selected",
      },
      expire: {
        title: {
          one: "Set expiry for {count} machine",
          other: "Set expiry for {count} machines",
        },
      },
      move: {
        title: {
          one: "Change the owner of {count} machine",
          other: "Change the owner of {count} machines",
        },
      },
      remove: {
        title: {
          one: "Remove {count} machine",
          other: "Remove {count} machines",
        },
        body: {
          one: "{count} machine will be permanently removed from your network. To re-add it, you will need to reauthenticate to your tailnet from the device.",
          other:
            "{count} machines will be permanently removed from your network. To re-add them, you will need to reauthenticate to your tailnet from each device.",
        },
      },
    },
    chip: {
      exitNode: "Exit Node",
      exitNodeEnabled: "This machine is acting as an exit node.",
      exitNodePending:
        'This machine is requesting to be used as an exit node. Review this from the "Edit route settings..." option in the machine\'s menu.',
      subnets: "Subnets",
      subnetEnabled: "This machine advertises subnet routes.",
      subnetPending:
        'This machine has unadvertised subnet routes. Review this from the "Edit route settings..." option in the machine\'s menu.',
      expiredOn: "Expired {date}",
      noExpiry: "No expiry",
      expiredTooltip:
        "This machine is expired and will not be able to connect to the network. Re-authenticate with Tailscale on the machine to re-enable it.",
      noExpiryTooltip:
        "This machine has key expiry disabled and will never need to re-authenticate.",
      expiringSoon: {
        one: "Expires in {count} day",
        other: "Expires in {count} days",
      },
      expiringSoonTooltip:
        "This machine’s key expires soon. Re-authenticate or disable key expiry before then to keep it connected.",
      tailscaleSsh: "Tailscale SSH",
      tailscaleSshTooltip:
        "This machine advertises Tailscale SSH, which allows you to authenticate SSH credentials using your Tailscale account and via the HeadplaneCN web UI.",
      agent: "HeadplaneCN Agent",
      agentTooltip:
        "This machine is running the HeadplaneCN agent, which allows it to provide host information in the web UI.",
    },
  },
  users: {
    list: {
      title: "Users",
      subtitle: "Manage the users in your network and their permissions.",
      headplaneSection: "HeadplaneCN Users",
      empty: "No users have signed into HeadplaneCN yet.",
      columnUser: "User",
      columnRole: "Role",
      columnLastLogin: "Last Login",
      columnStatus: "Status",
      columnCreatedAt: "Created At",
      actions: "Actions",
      unlinkedSection: "Unlinked Headscale Users",
      unlinkedBody:
        "These Headscale users are not linked to a HeadplaneCN account and cannot be managed through HeadplaneCN.",
      apiError:
        "Could not connect to the Headscale API. Headscale user data and machine information are unavailable.",
    },
    row: {
      notLinked: "Not linked",
      noMachines: "No machines",
      connected: "Connected",
      never: "Never",
    },
    roles: {
      owner: "Owner",
      admin: "Admin",
      networkAdmin: "Network Admin",
      itAdmin: "IT Admin",
      auditor: "Auditor",
      viewer: "Viewer",
      member: "Member",
      unknown: "Unknown",
    },
    roleDesc: {
      admin: "Can view the admin console, manage network, machine, and user settings.",
      networkAdmin:
        "Can view the admin console and manage ACLs and network settings. Cannot manage machines or users.",
      itAdmin:
        "Can view the admin console and manage machines and users. Cannot manage ACLs or network settings.",
      auditor: "Can view the admin console.",
      viewer: "Can view machines, users, and generate their own auth keys.",
      member: "Cannot view the admin console.",
      unknown: "No description available.",
    },
    banner: {
      oidc: "Users are managed through your {link}.",
      oidcLink: "OIDC provider",
      local: "Users are managed locally. {link}",
      setupOidc: "Set up OIDC",
    },
    create: {
      addUser: "Add user",
      title: "Create a Headscale user",
      body: "This creates a new user in Headscale. The user will appear in the “Unlinked Headscale Users” section until they sign in and are automatically linked to a HeadplaneCN account.",
      bodyOidc:
        "This creates a new user in Headscale. The user will appear in the “Unlinked Headscale Users” section until they sign in through your OIDC provider and are automatically linked to a HeadplaneCN account.",
      username: "Username",
      usernameRule:
        "Usernames must be at least 2 characters, start with a letter, and contain only letters, numbers, dots, dashes and underscores, with at most one @ that cannot be the last character.",
      displayName: "Display Name",
      email: "Email",
      placeholderUsername: "my-new-user",
      placeholderDisplayName: "John Doe",
      placeholderEmail: "name@example.com",
    },
    rename: {
      title: "Rename {name}?",
      body: "Enter a new username for {name}. Changing a username will not update any ACL policies that may refer to this user by their old username.",
      placeholder: "my-new-name",
    },
    link: {
      title: "Link Headscale user for {name}",
      body: "Select which Headscale user this identity should be linked to. This controls which machines they can manage and enables self-service features.",
      allLinked: "All Headscale users are already linked to other accounts.",
      selectPlaceholder: "Select a Headscale user...",
      current: " (current)",
    },
    changeRole: {
      title: "Change role for {name}?",
      body: "Roles control what the user can access in HeadplaneCN. Each role grants a specific set of capabilities.",
      ownerNotice: "The Tailnet owner cannot be reassigned.",
      label: "Role",
    },
    groups: {
      title: "Edit ACL groups for {name}",
      body: "Groups live in the ACL policy, not in Headscale. Changing them here rewrites the {code} section of your policy. See the {link} for details.",
      tailscaleGuide: "Tailscale ACL guide",
      commentsWarning:
        "Your policy contains comments. Saving here rewrites the policy and drops them.",
      emptyText: "This user is not in any group",
      label: "Groups",
      placeholder: "group:example",
      policyReadOnly:
        "The ACL policy is read-only. Set `policy.mode` to `database` in your Headscale configuration to edit groups.",
    },
    delete: {
      title: "Delete {name}?",
      hasMachines:
        "Users cannot be deleted if they have machines. Please delete or re-assign their machines to other users before proceeding.",
      body: "Deleted users cannot be recovered.",
      oidcNotice:
        "Since this user is authenticated via an external provider, they will be recreated if they sign in again.",
    },
    transfer: {
      title: "Transfer ownership to {name}?",
      body: "This will make {name} the new owner of this HeadplaneCN instance. You will be demoted to an Admin. This action cannot be easily undone.",
      notice:
        "Only the owner can transfer ownership. After this, you will no longer be able to manage ownership.",
    },
    menu: {
      changeRole: "Change role",
      changeLinkedUser: "Change linked user",
      linkHeadscaleUser: "Link Headscale user",
      editGroups: "Edit groups",
      transferOwnership: "Transfer ownership",
      delete: "Delete",
      rename: "Rename",
    },
  },
  acls: {
    title: "Access Control List (ACL)",
    body: "The ACL file is used to define the access control rules for your network. You can find more information about the ACL file in the {tailscaleGuide} and the {headscaleDocs}.",
    links: {
      tailscaleGuide: "Tailscale ACL guide",
      headscaleDocs: "Headscale docs",
    },
    restricted: {
      title: "ACL Policy restricted",
      body: "You do not have the necessary permissions to edit the Access Control List policy. Please contact your administrator to request access or to make changes to the ACL policy.",
    },
    readOnly: {
      title: "Read-only ACL Policy",
      body: "The ACL policy mode is most likely set to {file} in your Headscale configuration. This means that the ACL file cannot be edited through the web interface. In order to resolve this, you'll need to set {policyMode} to {database} in your Headscale configuration.",
    },
    updated: "Updated policy",
    check: {
      button: "Validate",
      success: {
        title: "Policy is valid",
        body: "Headscale accepted this policy through its check endpoint. It is safe to save.",
      },
      failure: {
        title: "Policy was rejected",
        body: "Headscale reported the following problem with the policy:",
      },
      errors: {
        policyRejected: "Headscale rejected this policy, so it was not saved. Its message was:",
      },
    },
    parseError: {
      title: "Policy cannot be edited visually",
      body: "The policy could not be parsed ({error}). Fix it in the {editFile} tab and the visual editor will come back.",
    },
    commentsWarning: {
      title: "Comments will be removed",
      body: "This policy contains comments. Saving a change made in the visual editor rewrites the policy and drops them.",
    },
    updateError: {
      fallbackTitle: "Error",
      fallbackBody: "An unknown error occurred while trying to update the ACL policy.",
    },
    editor: {
      label: "ACL Editor",
      loadFailed: "Failed to load the editor.",
      noChanges: "No changes",
      tabs: {
        rules: "Rules",
        grants: "Grants",
        tagsGroups: "Tags & Groups",
        editFile: "Edit file",
        diff: "Preview changes",
        preview: "Preview rules",
      },
      previewPending:
        "Previewing rules is not available yet. This feature is still in development and is pretty complicated to implement. Hopefully I will be able to get to it soon.",
      save: "Save",
      discard: "Discard Changes",
    },
    unavailable: {
      title: "ACL Policy Unavailable",
      body: "The ACL policy is currently unavailable because the policy file does not exist on the server. This usually indicates that Headscale is running in {file} mode for ACLs, and the specified policy file is missing.",
      actions: "In order to resolve this issue, there are two possible actions you can take:",
      createFile:
        "Create the ACL policy file at the specified path in your Headscale configuration.",
      switchDatabase:
        "Alternatively, you can switch Headscale to use {database} mode for ACLs by updating your Headscale configuration. This will allow HeadplaneCN to manage the ACL policy directly through the web interface.",
    },
    common: {
      sources: "Sources",
      destinations: "Destinations",
      noSources: "No sources yet",
      noDestinations: "No destinations yet",
      nameLabel: "Name",
      add: "Add",
      edit: "Edit",
      delete: "Delete",
    },
    aclRule: {
      editTitle: "Edit access rule",
      newTitle: "New access rule",
      body: "Access rules allow traffic from a set of sources to a set of destinations. Destinations must include a port, for example {example}. If you leave the port out, {allPorts} is added for you. See the {guide} for the full syntax.",
      sourcesDescription:
        "Groups, tags, hosts, users or autogroups allowed to initiate the connection.",
      sourcesPlaceholder: "group:eng",
      destinationsDescription:
        "Where the traffic is allowed to go. A destination without a port becomes :* (all ports).",
      destinationsPlaceholder: "tag:web:80,443",
      protocolDescription:
        "Optional. Restricts the rule to a single protocol (tcp, udp, icmp, ...).",
      protocolLabel: "Protocol",
      protocolPlaceholder: "tcp",
    },
    sshRule: {
      editTitle: "Edit SSH rule",
      newTitle: "New SSH rule",
      body: "SSH rules control Tailscale SSH access between nodes. Read the {link} for details about check mode.",
      docs: "Tailscale SSH documentation",
      actionLabel: "Action",
      actionAccept: "Accept — allow the session immediately",
      actionCheck: "Check — require periodic re-authentication",
      actionUnknown: "{action} — not known to HeadplaneCN",
      sourcesDescription: "Who is allowed to open the SSH session.",
      sourcesPlaceholder: "group:ops",
      destinationsDescription: "The nodes that accept the SSH session.",
      destinationsPlaceholder: "tag:server",
      usersLabel: "SSH users",
      usersDescription: "The local Unix users that may be logged into.",
      usersEmpty: "No SSH users yet",
      usersPlaceholder: "autogroup:nonroot",
      checkDescription: "How long a check-mode session stays valid, for example 12h.",
      checkLabel: "Check period",
      checkPlaceholder: "12h",
    },
    host: {
      editTitle: "Edit host {name}",
      newTitle: "New host",
      body: "Hosts give a name to an IP address or CIDR range so it can be referenced from rules.",
      duplicate: "A host with this name already exists.",
      invalid: "Host names may only contain lowercase letters, numbers and dashes.",
      namePlaceholder: "office",
      addressLabel: "Address",
      addressPlaceholder: "100.64.0.0/24",
    },
    namedList: {
      group: "group",
      tag: "tag",
      editTitle: "Edit {kind} {name}",
      newTitle: "New {kind}",
      duplicate: "A {kind} with this name already exists.",
      groupHint:
        "Group names must start with group: and may only contain lowercase letters, numbers and dashes.",
      tagHint:
        "Tag names must start with tag: and may only contain lowercase letters, numbers and dashes.",
      membersLabel: "Members",
      membersDescription: "Headscale users that belong to this group.",
      membersEmpty: "No members yet",
      membersPlaceholder: "alice@",
      ownersLabel: "Tag owners",
      ownersDescription: "Users and groups allowed to assign this tag to a node.",
      ownersEmpty: "No owners yet",
      ownersPlaceholder: "group:ops",
      examplePlaceholder: "example",
    },
    groups: {
      title: "Groups",
      description:
        "Groups bundle users together so rules can refer to a team instead of individual accounts. Membership is stored in the policy, not in Headscale.",
      empty: "No groups are defined yet.",
      noMembers: "No members",
    },
    tags: {
      title: "Tags",
      description:
        "Tags identify machines by role instead of by owner. A tag must be declared here before it can be assigned to a node — see the {link}.",
      docs: "Tailscale tag documentation",
      empty: "No tags are defined yet.",
      notAssigned: "Not assigned to any machine",
      usedBy: {
        one: "{count} machine: {names}",
        other: "{count} machines: {names}",
      },
      noOwners: "No owners",
    },
    rules: {
      title: "Access rules",
      description: "Rules are evaluated top to bottom. Traffic is denied unless a rule allows it.",
      empty: "No access rules are defined yet.",
      allow: "Allow",
    },
    sshSection: {
      title: "SSH rules",
      description: "Control which nodes can be reached over Tailscale SSH and as which local user.",
      empty: "No SSH rules are defined yet.",
      as: "as",
    },
    hostsSection: {
      title: "Hosts",
      description: "Named IP addresses and CIDR ranges that can be referenced from rules.",
      empty: "No hosts are defined yet.",
    },
    grants: {
      title: "Grants",
      description:
        "Grants are the modern replacement for access rules: the destination decides where traffic goes and the ip list decides which ports are allowed.",
      empty: "No grants are defined yet.",
    },
    grantRule: {
      editTitle: "Edit grant",
      newTitle: "New grant",
      body: "A grant allows traffic from a set of sources to a set of destinations. Unlike access rules, ports are chosen by the ip list instead of the destination.",
      sourcesDescription:
        "Groups, tags, hosts, users or autogroups allowed to initiate the connection.",
      sourcesPlaceholder: "group:eng",
      destinationsDescription:
        "Where the traffic is allowed to go. Unlike access rules, no port is appended here.",
      destinationsPlaceholder: "tag:web",
      ipLabel: "IPs and ports",
      ipDescription:
        "Ports this grant allows, optionally prefixed with tcp: or udp:, for example tcp:443, 80,443 or 1000-2000.",
      ipPlaceholder: "tcp:443",
      ipEmpty: "No ports yet",
      ipRequired:
        "Ports decide which traffic a grant opens, so a grant without an app must allow at least one port.",
      appNote: "This grant defines an app, so the port list may stay empty.",
      viaLabel: "Via",
      viaDescription:
        "Optional. Tags of the nodes the traffic has to pass through for the grant to apply.",
      viaEmpty: "No via tags yet",
      viaPlaceholder: "tag:router",
      appLabel: "App",
      appDescription:
        "An app grant targets an application served by connector nodes instead of opening ports.",
      appAdd: "Define app",
      appClear: "Clear app",
      appNameLabel: "App name",
      appNamePlaceholder: "mydb",
      appConnectorsLabel: "Connectors",
      appConnectorsDescription: "Tags of the nodes that serve this application.",
      appConnectorsEmpty: "No connectors yet",
      appConnectorsPlaceholder: "tag:connector",
    },
    tailnetOptions: {
      title: "Tailnet options",
      description: "Policy-wide settings that apply to every device in the tailnet.",
      randomizeClientPortLabel: "Randomize client port",
      randomizeClientPortDescription:
        "Lets a device pick a random source port for outgoing connections instead of keeping one stable.",
      randomizeClientPortUnset: "Not set",
      randomizeClientPortClear: "Reset to not set",
      randomizeClientPortEnabled: "Enabled",
      randomizeClientPortDisabled: "Disabled",
    },
    unsupported: {
      title: "Unsupported policy sections",
      body: "This policy defines {sections}, which Headscale does not support. HeadplaneCN keeps those sections verbatim when the policy is saved.",
    },
    autoApprovers: {
      title: "Auto-approvers",
      description:
        "Users, groups and tags that may advertise a subnet route or an exit node without manual approval.",
      routesEmpty: "No subnet routes are auto-approved yet.",
      exitNodeLabel: "Exit nodes",
      noApprovers: "No approvers",
    },
    autoApprover: {
      editTitle: "Edit auto-approved route {route}",
      newTitle: "New auto-approved route",
      body: "Anyone listed here can advertise this subnet route without an administrator approving it.",
      routeLabel: "Route",
      routePlaceholder: "10.0.0.0/24",
      routeInvalid: "Enter an IPv4 or IPv6 CIDR range, for example 10.0.0.0/24.",
      duplicate: "This route already has auto-approvers.",
      approversLabel: "Approvers",
      approversDescription: "Users, groups or tags allowed to advertise this route.",
      approversEmpty: "No approvers yet",
      approversPlaceholder: "group:admin",
    },
    exitNode: {
      editTitle: "Edit exit node approvers",
      body: "Anyone listed here can advertise an exit node without an administrator approving it.",
      approversLabel: "Approvers",
      approversDescription: "Users, groups or tags allowed to advertise an exit node.",
      approversEmpty: "No approvers yet",
      approversPlaceholder: "group:admin",
    },
    nodeAttrs: {
      title: "Node attributes",
      description:
        "Node attributes enable features on the nodes, users, groups or tags they target.",
      empty: "No node attributes are defined yet.",
    },
    nodeAttr: {
      editTitle: "Edit node attribute",
      newTitle: "New node attribute",
      body: "Attributes are applied to every node matched by a target, for example drive:share or magicdns-aaaa.",
      targetsLabel: "Targets",
      targetsDescription: "Nodes, users, groups or tags that receive these attributes.",
      targetsPlaceholder: "tag:server",
      targetsEmpty: "No targets yet",
      attrsLabel: "Attributes",
      attrsDescription:
        "For example drive:share or magicdns-aaaa. Replace the profile in nextdns:<profile> with a real NextDNS profile ID.",
      attrsPlaceholder: "drive:share",
      attrsEmpty: "No attributes yet",
    },
  },
  dns: {
    readOnlyNotice:
      "The Headscale configuration is read-only. You cannot make changes to the configuration",
    noAccessNotice:
      "Your permissions do not allow you to modify the DNS settings for this tailnet.",
    magicTitle: "Magic DNS",
    magicBody:
      "Automatically register domain names for each device on the tailnet. Devices will be accessible at {code} when Magic DNS is enabled.",
    remove: "Remove",
    rename: {
      title: "Tailnet Name",
      body: "This is the base domain name of your Tailnet. Devices are accessible at {code} when Magic DNS is enabled.",
      label: "Tailnet name",
      button: "Rename Tailnet",
      dialogBody:
        "Keep in mind that changing this can lead to all sorts of unexpected behavior and may break existing devices in your tailnet.",
      placeholder: "ts.net",
    },
    magicToggle: {
      disable: "Disable Magic DNS",
      enable: "Enable Magic DNS",
      body: "Devices will no longer be accessible via your tailnet domain. The search domain will also be disabled.",
    },
    ns: {
      title: "Nameservers",
      body: "Set the nameservers used by devices on the Tailnet to resolve DNS queries. {link}",
      global: "Global Nameservers",
      override: "Override DNS servers",
      overrideLabel: "Override local DNS settings",
      overrideTooltip:
        "When enabled, use the DNS servers listed below to resolve names outside the tailnet. When disabled (default), devices will prefer their local DNS configuration. {link}",
      add: "Add nameserver",
      description: "Use this IPv4 or IPv6 address to resolve names.",
      label: "Nameserver",
      placeholder: "1.2.3.4",
      duplicate: "This nameserver already exists.",
      restrictTitle: "Restrict to domain",
      splitDns: "Split DNS",
      splitTooltip:
        "Only clients that support split DNS (Tailscale v1.8 or later for most platforms) will use this nameserver. Older clients will ignore it.",
      splitBody: "This nameserver will only be used for some domains.",
      domainLabel: "Domain",
      domainPlaceholder: "example.com",
      domainBody:
        "Only single-label or fully-qualified queries matching this suffix should use the nameserver.",
    },
    records: {
      title: "DNS Records",
      body: "Headscale supports adding custom DNS records to your Tailnet. As of now, only {a} and {aaaa} records are supported. {link}",
      empty: "No DNS records found",
      add: "Add DNS record",
      addBody: "Enter the domain and IP address for the new DNS record.",
      typeLabel: "Record Type",
      domainLabel: "Domain",
      domainPlaceholder: "test.example.com",
      ipLabel: "IP Address",
      duplicateField: "This record already exists.",
      duplicateBody: "A record with the domain name {name} and IP address {ip} already exists.",
    },
    importExport: {
      exportButton: "Export records",
      importButton: "Import records",
      title: "Import DNS records",
      body: "Paste the JSON from an exported file, or choose a .json file. Every record is checked before anything is written.",
      jsonLabel: "JSON",
      jsonPlaceholder: '[{ "name": "test.example.com", "type": "A", "value": "1.2.3.4" }]',
      fileLabel: "Choose a .json file",
      modeLabel: "Import mode",
      modeAppend: "Append",
      modeAppendBody: "Keep the current records and add the imported ones.",
      modeReplace: "Replace",
      modeReplaceBody: "Delete every current record first, then write the imported ones.",
      previewTitle: "Preview",
      previewIdle: "Nothing to import yet.",
      previewAdd: "Records that will be added: {count}",
      previewRemove: "Records that will be removed: {count}",
      previewSkip: "Duplicate entries skipped: {count}",
      previewTotal: "Records after the import: {count}",
      previewMore: "and {count} more",
      success: "Imported {imported} records and skipped {skipped} duplicates.",
      errors: {
        empty: "Paste JSON or choose a file that contains at least one record.",
        invalidJson: "This is not valid JSON. Check the text and try again.",
        notArray: "The JSON must be an array of records.",
        notObject: "Record {position} is not an object.",
        invalidName: "Record {position} needs a non-empty string name.",
        invalidType: "Record {position} needs a string type.",
        unsupportedType:
          "Record {position} has the unsupported type {type}. Supported types: {types}.",
        invalidValue: "Record {position} needs a non-empty string value.",
        tooManyRecords:
          "Too many records: this file contains {count}, but at most {max} are allowed.",
        conflictingRecord:
          "Records {position} and another entry share a name and type but have different values. HeadplaneCN keeps one record per name and type, so add the extra value in Headscale's configuration file instead.",
      },
    },
    domains: {
      title: "Search Domains",
      body: "Set custom DNS search domains for your Tailnet. When using Magic DNS, your tailnet domain is used as the first search domain.",
      label: "Search Domain",
      add: "Add",
    },
  },
  settings: {
    overview: {
      title: "Settings",
      intro:
        "Keys, authentication and the Headscale configuration live here, alongside the HeadplaneCN agent, operation log and snapshots.",
      headscaleSection: "Headscale",
      headplaneSection: "HeadplaneCN",
      preAuthTitle: "Pre-Auth Keys",
      preAuthBody:
        "Headscale fully supports pre-authentication keys in order to easily add devices to your Tailnet. To learn more about using pre-authentication keys, visit the {link}",
      tailscaleDocs: "Tailscale documentation",
      manageAuthKeys: "Manage Auth Keys",
      apiKeysTitle: "API Keys",
      apiKeysBody:
        "API keys let tools and integrations authenticate against the Headscale API. The full key is shown only once, when it is created.",
      manageApiKeys: "Manage API Keys",
      agentTitle: "HeadplaneCN Agent",
      agentBody:
        "The HeadplaneCN Agent syncs node information like OS version and connectivity details from your Tailnet.",
      agentSettings: "Agent Settings",
      restrictionsTitle: "Authentication Restrictions",
      restrictionsBody:
        "Headscale supports restricting OIDC authentication to only allow certain email domains, groups, or users to authenticate. This can be used to limit access to your Tailnet to only certain users or groups and HeadplaneCN will also respect these settings when authenticating. {link}",
      manageRestrictions: "Manage Restrictions",
      headscaleTitle: "Headscale Settings",
      headscaleBody:
        "Edit the parts of Headscale's own configuration file that HeadplaneCN can safely change: OpenID Connect, trusted proxies, and where the Access Control policy is stored.",
      manageHeadscale: "Manage Headscale Settings",
      systemTitle: "System Status",
      systemBody:
        "Check whether the Headscale server HeadplaneCN manages is healthy, which version it runs, and whether a newer release is available.",
      systemStatus: "View System Status",
      auditTitle: "Operation Log",
      auditBody:
        "See who changed what through HeadplaneCN, with filters for the actor, the action and how far back to look.",
      manageAudit: "View Operation Log",
      snapshotsTitle: "Configuration Snapshots",
      snapshotsBody:
        "Copy Headscale's configuration files before they are changed, then download or restore an earlier version if something goes wrong.",
      manageSnapshots: "Manage Snapshots",
      notificationsTitle: "Alert Notifications",
      notificationsBody:
        "Tell an operator when Headscale goes down, a node drops offline, an API key is about to expire, or a configuration check starts failing.",
      notificationsSettings: "Manage Notifications",
    },
    system: {
      breadcrumb: "System Status",
      title: "System Status",
      body: "Health, version, and configuration checks for the Headscale server that HeadplaneCN manages.",
      statusTitle: "Health",
      statusHealthy: "Headscale is reachable",
      statusUnhealthy: "Headscale is unreachable",
      statusUnhealthyBody:
        "HeadplaneCN could not reach the Headscale API. Start Headscale, then reload this page.",
      versionLabel: "Running version",
      updateBadge: "Update available",
      updateBody: "Headscale {latest} is available. This server runs {current}.",
      checksTitle: "Diagnostics",
      checksBody: "Each check explains what was found and where it can be fixed.",
      checkStatusPass: "Passed",
      checkStatusWarning: "Warning",
      checkStatusFail: "Failed",
      statusPass: "{count} pass",
      statusWarning: "{count} warning",
      statusFail: "{count} fail",
      reviewSettings: "Review Headscale settings",
      summaryHealthy: "Healthy, running {version}",
      summaryChecks: "{total} checks: {pass} pass, {warning} warning, {fail} fail",
      summaryChecksUnavailable: "Configuration file not readable",
      summaryProcessNone: "No integration configured",
      checksFailedTitle: "Failed checks: {count}",
      processTitle: "Process Control",
      processBody:
        "HeadplaneCN can ask the configured integration to reload or restart Headscale for you.",
      processReload: "Reload configuration",
      processRestart: "Restart Headscale",
      processPending: "Working…",
      processSuccess: "The integration accepted the request.",
      processRestrictedTitle: "Read-only Access",
      processUnavailableTitle: "No Integration Enabled",
      processUnavailableBody:
        "HeadplaneCN can only reload or restart Headscale when the Docker, Kubernetes, or native (/proc) integration is enabled. See the {link} for setup instructions.",
      processUnavailableLink: "documentation",
      processSemanticsReload:
        "{name} sends SIGHUP to the Headscale process, which reloads the configuration without dropping connections.",
      processSemanticsRestart: "{name} restarts the Headscale container or pod.",
      errors: {
        invalidAction: "The request was invalid. Reload the page and try again.",
        notAvailable:
          "No integration is enabled, so HeadplaneCN cannot reload or restart Headscale.",
        failed:
          "The integration could not reach Headscale. Check the HeadplaneCN logs for details.",
      },
      checks: {
        reachable: {
          title: "Headscale reachable",
          pass: "The /health endpoint answered, so HeadplaneCN can talk to the Headscale API.",
          fail: "The /health endpoint did not answer. Check that Headscale is running and that its URL in the HeadplaneCN configuration is correct.",
        },
        apiKey: {
          title: "API key valid",
          pass: "The Headscale API accepted the configured API key.",
          invalid:
            "Headscale rejected the configured API key, so it is invalid or expired. Generate a new key and update the HeadplaneCN configuration.",
          unknown:
            "HeadplaneCN could not check the API key because the request failed for another reason. Check the HeadplaneCN logs for details.",
        },
        version: {
          title: "Headscale version",
          pass: "Headscale {version} supports every feature HeadplaneCN offers.",
          recommended:
            "Headscale {version} works, but {recommended} or newer is recommended: browser SSH is broken on the 0.29 beta releases through 0.29.1.",
          tooOld:
            "Headscale {version} is older than {minimum}, so features such as the HeadplaneCN Agent and browser SSH are unavailable.",
        },
        policyMode: {
          title: "Access Control policy mode",
          pass: "Headscale stores the policy in its database, so the Access Control editor can save through the API.",
          file: "Headscale reads the policy from a file, so the Access Control editor cannot save through the API. Switch to the database mode to edit the policy in HeadplaneCN.",
          unknown:
            "HeadplaneCN cannot read Headscale's configuration file, so the policy mode is unknown.",
        },
        oidc: {
          title: "OIDC configured",
          pass: "Headscale has an OIDC provider configured, which browser SSH and single sign-on require.",
          missing:
            "Headscale has no OIDC provider configured. Browser SSH and single sign-on stay unavailable until one is set up.",
          unknown:
            "HeadplaneCN cannot read Headscale's configuration file, so it cannot tell whether OIDC is configured.",
        },
        trustedProxies: {
          title: "Trusted proxies",
          pass: "HeadplaneCN did not detect a reverse proxy, or Headscale already trusts the proxy in front of it.",
          missing:
            "HeadplaneCN looks like it is reached through a reverse proxy, but Headscale has no trusted_proxies configured. Client addresses and some sign-in flows can be wrong until the proxy address range is added.",
        },
        configAccess: {
          title: "Headscale configuration file",
          pass: "HeadplaneCN can read and write Headscale's configuration file.",
          readOnly:
            "HeadplaneCN can read Headscale's configuration file but not write to it. Mount the file read-write to change these settings from HeadplaneCN.",
          unreadable:
            "HeadplaneCN cannot read Headscale's configuration file. Check the headscale.config_path setting and the file permissions.",
        },
        integration: {
          title: "Integration enabled",
          pass: "{name} is enabled, so HeadplaneCN can reload or restart Headscale for you.",
          missing:
            "No integration is enabled, so HeadplaneCN cannot reload or restart Headscale. Enable the Docker, Kubernetes, or native (/proc) integration.",
        },
      },
      configChecks: {
        title: "Configuration",
        body: "These checks read Headscale's own config.yaml and the files it points at, the same way headscale configtest does. Fix them in the file before Headscale is restarted.",
        unavailable:
          "HeadplaneCN could not read Headscale's configuration file, so the configuration checks are unavailable.",
        pathUnavailable:
          "Cannot check {path}: it is not visible to this process, which normally means the container running HeadplaneCN does not mount that directory. Mount it to have this verified.",
        oidcKeys: {
          title: "Unsupported OIDC keys",
          pass: "The configuration does not contain any of the OIDC keys that Headscale 0.29 refuses to start with.",
          fail: "The configuration still contains {keys}. Headscale 0.29 refuses to start while these keys are present; remove them and set node lifetime with the top-level node.expiry instead.",
        },
        trustedProxies: {
          title: "Trusted proxy entries",
          pass: "Every trusted_proxies entry is a usable address range.",
          fail: "Headscale rejects {proxies}: the unspecified ranges (0.0.0.0/0 and ::/0) are configuration errors, and trusting every address would defeat the setting.",
        },
        tls: {
          title: "TLS and ACME",
          none: "No certificate is configured, so Headscale serves plain HTTP. That is only safe behind a reverse proxy that terminates TLS.",
          pass: "The configured certificate files exist and can be read.",
          missingFile:
            "Headscale cannot read {path}: the certificate or key is missing, unreadable, or not a regular file.",
          conflict:
            "Both tls_letsencrypt_hostname ({hostname}) and a static certificate ({path}) are configured. Headscale uses the static certificate, so the ACME hostname has no effect.",
          insecure:
            "server_url is set to {url} while a certificate is configured, so clients connect over plain HTTP unless a reverse proxy terminates TLS in front of Headscale.",
        },
        database: {
          title: "Database",
          pass: "The SQLite database directory is writable and {path} exists.",
          external:
            "Headscale uses an external {type} database, so there is no SQLite file to create.",
          missingFile:
            "{path} does not exist yet. Headscale creates the SQLite database on its first start.",
          missingDir:
            "The directory {path} does not exist, so Headscale cannot create its SQLite database there.",
          readOnlyDir:
            "HeadplaneCN cannot write to {path}, which is usually a read-only mount, so it cannot tell whether Headscale can. That is normal for a read-only mount — only act on it if Headscale itself reports that it cannot write its database.",
        },
        policy: {
          title: "Access Control policy file",
          database: "Headscale stores the policy in its database, so no policy file is needed.",
          pass: "The policy file at {path} exists and is not empty.",
          missingPath:
            "policy.mode is file but policy.path is empty, so Headscale loads no policy and allows every node.",
          empty: "The policy file at {path} is empty, which Headscale treats as allow-all.",
          missingFile:
            "The policy file at {path} does not exist, so Headscale has no policy to load.",
          unreadable:
            "The policy file at {path} cannot be read, so Headscale has no policy to load.",
        },
        dns: {
          title: "DNS records",
          pass: "Only one source of extra DNS records is configured.",
          conflict:
            "Both dns.extra_records and dns.extra_records_path are set. HeadplaneCN reads the JSON file at {path} and ignores the inline records, and Headscale has to pick one of the two sources.",
          review: "Review DNS records",
        },
        oidc: {
          title: "OIDC settings",
          pass: "The OIDC block is coherent.",
          missingClientId:
            "An issuer ({issuer}) is configured without a client_id, so Headscale cannot start the login flow.",
          missingIssuer:
            "A client_id ({clientId}) is configured without an issuer, so Headscale cannot discover the provider.",
          badPkce: "pkce.method is set to {method}, but Headscale only accepts plain or S256.",
          secrets:
            "Both client_secret and client_secret_path are set. Headscale reads the inline client_secret, so the file is ignored.",
        },
        noise: {
          title: "Noise private key",
          pass: "The Noise private key at {path} exists and can be read.",
          database:
            "No noise.private_key_path is configured, so Headscale keeps the Noise key in its database.",
          fail: "The Noise private key at {path} is missing or unreadable while a database already exists, so Headscale cannot start.",
          firstStart:
            "The Noise private key at {path} does not exist yet, but neither does the database, so Headscale generates it on first start.",
        },
        relayUnavailable:
          "Cannot check {host}: the DNS lookup did not complete, so HeadplaneCN cannot tell which addresses clients reach. The answer, including a negative one, is cached for five minutes, so reload this page to try again.",
        relayHostUnusable:
          "Cannot check the relay address: server_url is not a usable http(s) URL, so HeadplaneCN does not know which host clients reach.",
        derpIpv4: {
          title: "Embedded relay IPv4",
          disabled:
            "Headscale's embedded DERP server is disabled, so there is no relay address to check.",
          undeclared:
            "derp.server.ipv4 is not set, so there is nothing to compare. Clients reach the relay over IPv4 only while this stays empty.",
          match: "{host} resolves to {address}, the address derp.server.ipv4 declares.",
          mismatch:
            "derp.server.ipv4 declares {address}, but {host} does not resolve to it. This is usually a stale address left behind after the machine's IP changed; update derp.server.ipv4 or the hostname's A record.",
          missingRecord:
            "derp.server.ipv4 declares {address}, but {host} has no A record at all, so clients cannot reach the relay over IPv4 at that address. Publish an A record for this hostname pointing at the machine running the relay, or clear derp.server.ipv4.",
        },
        derpIpv6: {
          title: "Embedded relay IPv6",
          disabled:
            "Headscale's embedded DERP server is disabled, so there is no relay address to check.",
          undeclared:
            "derp.server.ipv6 is not set, so there is nothing to compare. Clients reach the relay over IPv4 only; set it and publish a matching AAAA record to offer the relay over IPv6.",
          match: "{host} resolves to {address}, the address derp.server.ipv6 declares.",
          mismatch:
            "derp.server.ipv6 declares {address}, but {host} does not resolve to it, so clients cannot use the relay over IPv6 at that address. Add an AAAA record for this hostname pointing at the machine running the relay, or accept IPv4-only.",
          missingRecord:
            "derp.server.ipv6 declares {address}, but {host} has no AAAA record at all, so clients cannot use the relay over IPv6. Add an AAAA record for this hostname pointing at the machine running the relay, or accept IPv4-only. A host resolver can answer with no AAAA even when the name has one: compare `dig @1.1.1.1 +short AAAA {host}` with `dig +short AAAA {host}`, and if the first answers, point this host's DNS at a resolver that returns AAAA. The negative answer is cached for five minutes; restart HeadplaneCN to clear it.",
        },
        derpMap: {
          exists: { title: "DERP map file exists ({path})" },
          readable: { title: "DERP map file is readable ({path})" },
          writable: { title: "DERP map file is writable ({path})" },
          size: { title: "DERP map file is within the editing size limit ({path})" },
          parses: { title: "DERP map is valid YAML ({path})" },
          schema: { title: "DERP map document is valid ({path})" },
          unique: { title: "DERP map region ids and codes are unique ({path})" },
        },
      },
      selfUpdate: {
        title: "HeadplaneCN update available",
        body: "HeadplaneCN {latest} is available. This instance reports {current}, the version baked in at build time (__VERSION__), so a custom build that reports its own version is never nagged. {link}",
        link: "View the release",
      },
      metrics: {
        title: "Metrics",
        body: "Read directly from Headscale's metrics listener. Nothing on this page is written back to Headscale.",
        addressLabel: "Metrics address",
        disabled:
          "Headscale's configuration does not set metrics_listen_addr, so its metrics listener is disabled. Set the address and restart Headscale to see metrics here.",
        invalid:
          "HeadplaneCN cannot parse the metrics_listen_addr value “{value}”. Use host:port, for example 127.0.0.1:9090.",
        unknown:
          "HeadplaneCN could not read Headscale's configuration file, so it cannot tell where the metrics listener is.",
        unreachableTitle: "Metrics listener unreachable",
        unreachable:
          "HeadplaneCN could not read {url}. The metrics listener must be reachable from HeadplaneCN itself; Headscale listens on {address}.",
        groups: {
          nodes: "Nodes",
          users: "Users",
          relay: "DERP and relays",
          policy: "Policy",
          process: "Process",
        },
        goroutinesLabel: "Goroutines",
        uptimeLabel: "Uptime",
        uptimeValue: "{days}d {hours}h {minutes}m",
        seriesLabel: "{count} series",
        rawTitle: "Raw metrics",
        rawDescription: "The exposition text exactly as HeadplaneCN received it.",
        rawTruncated: "Showing the first {chars} characters.",
      },
      tabsLabel: "System status sections",
      groups: {
        connection: "Connection",
        version: "Version",
        configuration: "Headscale configuration",
        integration: "Integration",
        oidc: "OIDC settings",
        proxies: "Trusted proxies",
        tls: "TLS and ACME",
        database: "Database and keys",
        policy: "Access control policy",
        dns: "DNS records",
        relay: "Embedded relay",
        derpMaps: "DERP map files",
      },
    },
    headscale: {
      breadcrumb: "Headscale Settings",
      title: "Headscale Settings",
      body: "These settings are written directly to Headscale's config.yaml, and only take effect after Headscale is restarted.",
      notWritableTitle: "Configuration Locked",
      notWritableBody:
        "HeadplaneCN can only change these settings when Headscale's configuration file is mounted read-write. Mount {file} into the HeadplaneCN container with write access and restart HeadplaneCN.",
      readOnlyTitle: "Read-only Access",
      oidcTitle: "OpenID Connect",
      oidcBody:
        "Sign-in through your identity provider. The permitted email domains, groups, and users are managed on the {link} page.",
      restrictionsLink: "Authentication Restrictions",
      oidcMissingTitle: "OIDC Is Not Configured",
      oidcMissingBody:
        "Headscale has no oidc: block in its configuration file yet. Saving this form creates one.",
      issuerLabel: "Issuer",
      issuerDescription:
        "The discovery URL of your identity provider, for example https://accounts.example.com. Leave it empty to disable OIDC.",
      clientIdLabel: "Client ID",
      clientSecretLabel: "Client Secret",
      clientSecretSet:
        "A client secret is already configured. Leave this field empty to keep the current secret.",
      clientSecretUnset: "No client secret is configured yet.",
      scopeLabel: "Scope",
      scopeDescription: "Scopes requested from the provider, separated by commas or spaces.",
      emailVerifiedRequiredLabel: "Require verified email",
      emailVerifiedRequiredDescription:
        "Only accept sign-ins whose email address the provider reports as verified.",
      useExpiryFromTokenLabel: "Use expiry from token",
      useExpiryFromTokenDescription:
        "Take the node expiry from the OIDC token instead of the Headscale defaults.",
      onlyStartIfOidcLabel: "Only start if OIDC is available",
      onlyStartIfOidcDescription:
        "Refuse to start Headscale when the identity provider cannot be reached.",
      pkceEnabledLabel: "Enable PKCE",
      pkceEnabledDescription: "Use Proof Key for Code Exchange when talking to the provider.",
      pkceMethodLabel: "PKCE method",
      pkceMethodPlain: "plain",
      pkceMethodS256: "S256",
      saveOidc: "Save OIDC settings",
      trustedProxiesTitle: "Trusted Proxies",
      trustedProxiesBody:
        "Address ranges whose X-Forwarded-For headers Headscale trusts. Add the addresses your reverse proxy connects from; headers from anywhere else are ignored.",
      trustedProxiesEmpty: "No trusted proxies are configured.",
      addProxy: "Add proxy",
      proxyLabel: "CIDR",
      proxyPlaceholder: "10.0.0.0/8",
      removeProxy: "Remove",
      policyTitle: "Policy Mode",
      policyBody: "Where Headscale reads its Access Control policy from.",
      policyModeLabel: "Mode",
      policyModeFile: "File",
      policyModeFileDescription:
        "Headscale reads the policy from the file below. The Access Control editor cannot save through the API.",
      policyModeDatabase: "Database",
      policyModeDatabaseDescription:
        "Headscale stores the policy in its database, so the Access Control editor can save through the API.",
      policyPathLabel: "Policy path",
      policyWarning:
        "Switching the mode does not copy the policy. When you switch from file to database, the policy starts out empty (which allows everything) until you import it with {command} after restarting Headscale. Every change here needs a Headscale restart.",
      savePolicy: "Save policy mode",
      saved: "Saved.",
      statusConfigured: "Configured",
      statusEnabled: "Enabled",
      statusDisabled: "Disabled",
      statusAgentRequired: "Agent required",
      fatalTitle: "Unsupported OIDC keys",
      fatalBody:
        "This configuration still contains {keys}. Headscale 0.29 refuses to start when any of these keys are present; remove them and set node lifetime with the top-level {setting} instead.",
      advancedNodeTitle: "Node Lifecycle",
      advancedNodeBody:
        "How Headscale treats nodes over time. Both values are Headscale duration strings.",
      nodeExpiryLabel: "Default node expiry",
      nodeExpiryDescription:
        "Applied to new non-tagged nodes. Use a Headscale duration such as 720h or 30d, or 0 so nodes never expire. Headscale's default is 0.",
      ephemeralInactivityLabel: "Ephemeral inactivity timeout",
      ephemeralInactivityDescription:
        "How long an offline ephemeral node is kept before Headscale deletes it, for example 30m. Headscale refuses to start below 65s. Headscale's default is 120s.",
      saveNodeSettings: "Save node settings",
      advancedLogTitle: "Logging",
      advancedLogBody:
        "Log output of the Headscale server. Changes take effect after Headscale is restarted.",
      logLevelLabel: "Log level",
      logLevelDescription:
        "HeadplaneCN can only save debug, info, warn, and error. Headscale's default is info.",
      logFormatLabel: "Log format",
      logFormatDescription:
        "text for human-readable lines, json for structured output. Headscale's default is text.",
      saveLogSettings: "Save logging settings",
      advancedFeaturesTitle: "Features",
      advancedFeaturesBody:
        "Tailnet-wide feature switches that Headscale advertises to every node.",
      taildropLabel: "Taildrop",
      taildropDescription: "Allow nodes to send files to each other. Headscale's default is true.",
      autoUpdateLabel: "Default node auto-update",
      autoUpdateDescription:
        "Nodes that have not opted in or out locally update themselves automatically. Headscale's default is false.",
      logtailLabel: "Logtail",
      logtailDescription:
        "Let nodes send their logs to Tailscale's logging service. Headscale's default is false.",
      checkUpdatesLabel: "Check for updates on startup",
      checkUpdatesDescription:
        "Let Headscale look for a newer release when it starts. Stored as Headscale's inverse disable_check_updates, which defaults to false, so this switch is on by default.",
      saveFeatureSettings: "Save feature settings",
      advancedTitle: "Node lifetime, logs and switches",
      advancedBody:
        "How Headscale treats nodes over time, together with its log output and the tailnet-wide feature switches.",
      summaryNotConfigured: "Not configured",
      summaryIssuer: "Issuer: {issuer}",
      trustedProxiesSummary: "Configured ranges: {count}",
      policySummary: "Mode: {mode}",
      advancedSummary: "Node expiry {expiry} · log level {level}",
      advancedHaTitle: "HA subnet router health checks",
      advancedHaBody:
        "How Headscale probes HA subnet routers. When several nodes advertise the same prefix, Headscale pings each one on this interval and marks it unhealthy once a probe times out. Changes take effect after Headscale is restarted.",
      haProbeIntervalLabel: "Probe interval",
      haProbeIntervalDescription:
        "How often HA subnet routers are probed, for example 10s. Must be at least 2s, or 0 to disable probing. Headscale's default is 10s.",
      haProbeTimeoutLabel: "Probe timeout",
      haProbeTimeoutDescription:
        "How long a probe waits for an answer before the router counts as unhealthy, for example 5s. Must be at least 1s and shorter than the interval. Headscale's default is 5s.",
      saveHaSettings: "Save health check settings",
      extraParamsTitle: "Extra authorization parameters",
      extraParamsBody:
        "Key/value pairs sent to the identity provider's authorization endpoint, for example domain_hint, prompt, or acr_values. Saving an empty list removes oidc.extra_params from the file.",
      extraParamsEmpty: "No extra authorization parameters are configured.",
      extraParamsKeyLabel: "Parameter",
      extraParamsKeyPlaceholder: "domain_hint",
      extraParamsValueLabel: "Value",
      extraParamsValuePlaceholder: "example.com",
      addExtraParam: "Add parameter",
      removeExtraParam: "Remove",
      saveExtraParams: "Save extra parameters",
      selfTestTitle: "OIDC configuration test",
      selfTestBody:
        "Checks the configured issuer and client credentials against the identity provider without signing anyone in. Nothing is written to disk, and the client secret is never sent back to this page.",
      selfTestButton: "Test OIDC configuration",
      selfTestRunning: "Running checks…",
      selfTestSummary: "{passed} of {total} checks passed",
      selfTestSkipped: "{count} checks were skipped",
      selfTestStatusPass: "Passed",
      selfTestStatusWarn: "Warning",
      selfTestStatusFail: "Failed",
      selfTestStatusSkip: "Skipped",
      selfTestCheckIssuer: "Issuer URL",
      selfTestCheckDiscovery: "Discovery document",
      selfTestCheckEndpoints: "Provider endpoints",
      selfTestCheckJwks: "Signing keys (JWKS)",
      selfTestCheckScopes: "Requested scopes",
      selfTestCheckPkce: "PKCE",
      selfTestCheckCredentials: "Client credentials",
      selfTestCheckAccess: "Sign-in restrictions",
      selfTestCheckCallback: "Callback URL",
      selfTestIssuerMissing: "No issuer is configured, so Headscale has nothing to discover.",
      selfTestIssuerNotAbsolute:
        "The issuer is not an absolute URL, so no discovery document can be fetched. Include the scheme, for example https://idp.example.com.",
      selfTestIssuerInsecure:
        "The issuer uses {scheme}, which sends the sign-in flow in the clear. That is only acceptable for an identity provider on a trusted local network; use https for anything reachable from the internet.",
      selfTestIssuerUnsupportedScheme:
        "The issuer uses {scheme}, which is neither http nor https, so Headscale cannot fetch a discovery document from it.",
      selfTestIssuerOk: "The issuer is an absolute https URL.",
      selfTestDiscoverySkipped: "Not checked because no usable issuer URL is configured.",
      selfTestDiscoveryUnreachable:
        "The discovery document could not be read ({error}). Headscale refuses to start when only_start_if_oidc_is_available is on, and sign-in fails otherwise.",
      selfTestDiscoveryNoIssuer:
        "The document has no issuer field. Headscale compares that field with the configured issuer and rejects the provider when it is missing.",
      selfTestDiscoveryMismatch:
        "The document reports {actual}, but {expected} is configured. Headscale compares the two and refuses to authenticate anyone.",
      selfTestDiscoveryOk:
        "The document is reachable and its issuer matches the configured issuer.",
      selfTestEndpointsMissing:
        "The document does not advertise {endpoints}, which Headscale needs for the sign-in flow.",
      selfTestEndpointsOk: "The document advertises the authorization, token, and JWKS endpoints.",
      selfTestSkippedPrerequisite: "Not checked because an earlier check could not run.",
      selfTestJwksUnreachable: "The JWKS could not be read ({error}).",
      selfTestJwksEmpty:
        "The JWKS is reachable but contains no keys, so Headscale cannot verify any token.",
      selfTestJwksOk: "The JWKS advertised by the document is reachable.",
      selfTestScopesMissingOpenid:
        "The requested scopes do not include openid, so the provider will not return an ID token.",
      selfTestScopesMissingClaims:
        "The requested scopes do not include {scopes}. Without email the provider reports no verified address for allowed_domains, and without profile HeadplaneCN shows no name or picture.",
      selfTestScopesOk: "The requested scopes include openid, email, and profile.",
      selfTestPkceDisabled: "PKCE is disabled in the configuration, so no challenge is sent.",
      selfTestPkceMismatch:
        "The provider advertises {advertised} for code_challenge_methods_supported, which does not include the configured {method}.",
      selfTestPkceUnknown:
        "The document does not advertise code_challenge_methods_supported, so support for {method} cannot be confirmed.",
      selfTestPkceOk: "The provider advertises the configured PKCE method {method}.",
      selfTestCredentialsMissingClientId:
        "No client_id is configured, so Headscale cannot identify itself to the provider.",
      selfTestCredentialsMissingSecret:
        "Neither client_secret nor client_secret_path is set, and Headscale needs one of them to exchange the authorization code.",
      selfTestCredentialsBoth:
        "Both client_secret and client_secret_path are set. Headscale's own configuration comments call them mutually exclusive, so keep only one of the two.",
      selfTestCredentialsOk: "A client ID and a client secret are configured.",
      selfTestAccessMissing:
        "None of allowed_domains, allowed_groups, or allowed_users is set, so every account the provider authenticates may sign in.",
      selfTestAccessOk: "Sign-ins are limited by {lists}.",
      selfTestCallbackUnknown:
        "HeadplaneCN has no server.base_url, so the callback URL to register with the provider cannot be shown.",
      selfTestCallbackOk: "Register this redirect URI with the identity provider: {url}",
      clientSecretPathLabel: "Client secret file path",
      clientSecretPathDescription:
        "Read the client secret from a file instead of storing it inline. Headscale reads the file when it starts and expands environment variables in the path, which makes this the safer place for the secret. Leave it empty to remove oidc.client_secret_path.",
      clientSecretConflictTitle: "Two client secrets are configured",
      clientSecretConflictBody:
        "Both oidc.client_secret and oidc.client_secret_path are set. Headscale's own configuration comments call them mutually exclusive, so keep only one of the two.",
      overviewTab: "Overview",
      overviewTitle: "Configuration overview",
      overviewBody:
        "These values are read from Headscale's configuration file and are display-only. HeadplaneCN never writes them: a wrong database path or IP range can lock you out of the server, and the rest are operational or secret file paths.",
      overviewDisplayOnly: "Display only",
      overviewUnset: "—",
      overviewNetworkTitle: "Network",
      overviewServerUrlLabel: "Server URL",
      overviewListenAddrLabel: "Listen address",
      overviewPrefixV4Label: "IPv4 prefix",
      overviewPrefixV6Label: "IPv6 prefix",
      overviewPrefixAllocationLabel: "IP allocation",
      overviewDatabaseTitle: "Database",
      overviewDatabaseTypeLabel: "Type",
      overviewSqlitePathLabel: "SQLite path",
      overviewSqliteWalLabel: "Write-ahead log",
      overviewServicesTitle: "Listeners",
      overviewMetricsAddrLabel: "Metrics address",
      overviewGrpcAddrLabel: "gRPC address",
      overviewGrpcInsecureLabel: "gRPC plaintext",
      overviewUnixSocketLabel: "Unix socket",
      overviewUnixSocketPermissionLabel: "Socket permission",
      overviewNoiseKeyLabel: "Noise key path",
      overviewTlsTitle: "TLS and ACME",
      overviewTlsHostnameLabel: "Let's Encrypt hostname",
      overviewAcmeEmailLabel: "ACME email",
      overviewTlsCertPathLabel: "Certificate path",
      overviewTlsKeyPathLabel: "Certificate key path",
      overviewTuningTitle: "Tuning",
      overviewTuningLabel: "tuning block",
      derp: {
        title: "DERP",
        body: "Where Headscale gets the relay map it hands to clients, how often that map is refreshed, and whether Headscale runs the embedded DERP server itself. Relay usage per machine is listed below.",
        statusTitle: "DERP Relays",
        statusBody:
          "Where each machine connects through Headscale's DERP relays. Live relay data comes from the HeadplaneCN Agent.",
        statusAgentRequired:
          "Live relay data needs the HeadplaneCN Agent. Enable the agent so HeadplaneCN can read each machine's home region, preferred region, and DERP latency.",
        statusEmpty: "No machines have reported DERP relay information yet.",
        machine: "Machine",
        homeRegion: "Home region",
        preferredRegion: "Preferred region",
        latency: "Best latency",
        unknown: "Unknown",
        noLatency: "No data",
        relayMachineCount: {
          one: "{count} machine",
          other: "{count} machines",
        },
        pathCount: {
          one: "{count} path",
          other: "{count} paths",
        },
        urlsTitle: "DERP Map Sources",
        urlsBody:
          "URLs of DERP map files that Headscale merges and hands to every client. The public Tailscale map is a common entry.",
        urlsEmpty: "No DERP map URLs are configured.",
        urlLabel: "DERP map URL",
        urlPlaceholder: "https://controlplane.tailscale.com/derpmap/default",
        addUrl: "Add URL",
        removeUrl: "Remove",
        pathsTitle: "Local DERP Map Files",
        pathsBody:
          "Paths to DERP map files on the Headscale host. Headscale merges them with the URLs above.",
        pathsEmpty: "No local DERP map files are configured.",
        pathLabel: "DERP map path",
        pathPlaceholder: "/etc/headscale/derp-example.yaml",
        addPath: "Add path",
        removePath: "Remove",
        refreshTitle: "DERP Map Updates",
        refreshBody:
          "How often Headscale refreshes the DERP map from the sources above. Changes take effect after Headscale is restarted.",
        autoUpdateLabel: "Refresh the DERP map",
        autoUpdateDescription:
          "Let a background worker re-read the DERP sources periodically. Headscale's default is false.",
        updateFrequencyLabel: "Update frequency",
        updateFrequencyDescription:
          "How often the DERP sources are refreshed, for example 3h or 30m. Headscale's default is 3h.",
        saveRefresh: "Save DERP updates",
        serverTitle: "Embedded DERP Server",
        serverBody:
          "Run a DERP relay inside Headscale itself. It requires Headscale's server_url to use https, because DERP runs over TLS.",
        serverEnabledLabel: "Enable the embedded server",
        serverEnabledDescription:
          "Start the embedded DERP server and merge it into the DERP map. Headscale's default is false.",
        regionIdLabel: "Region ID",
        regionIdDescription:
          "Region ID reserved for this server. Headscale only accepts 900 to 999; its example uses 999.",
        regionCodeLabel: "Region code",
        regionCodeDescription: "Short code shown in the Tailscale client, for example headscale.",
        regionNameLabel: "Region name",
        regionNameDescription: "Display name of the region in the Tailscale client.",
        stunListenAddrLabel: "STUN listen address",
        stunListenAddrDescription:
          "UDP address that answers STUN requests for NAT traversal. 0.0.0.0:3478 listens on IPv4 only, while [::]:3478 is dual-stack, subject to the system's net.ipv6.bindv6only. An IPv6-only or dual-stack tailnet therefore needs the bracketed form; the same applies to Headscale's own listen_addr, which serves both the control API and the relay. Headscale requires it when the embedded server is enabled.",
        ipv4Label: "Public IPv4 address",
        ipv4Description:
          "Public IPv4 address Headscale advertises for this relay, for example 198.51.100.1. Setting it improves connection stability. Use a bare address without a CIDR or port, or leave it empty to unset derp.server.ipv4.",
        ipv6Label: "Public IPv6 address",
        ipv6Description:
          "Public IPv6 address Headscale advertises for this relay, for example 2001:db8::1. Setting it improves connection stability. Use a bare address without a CIDR or port, or leave it empty to unset derp.server.ipv6.",
        verifyClientsLabel: "Verify clients",
        verifyClientsDescription:
          "Only let clients registered with this Headscale use the embedded relay. Headscale's default is true.",
        autoAddRegionLabel: "Add the region automatically",
        autoAddRegionDescription:
          "Merge the embedded server into the DERP map. Turn it off to describe it yourself in a local DERP map file. Headscale's default is true.",
        keyConfigured: "A private key path is configured for the embedded server.",
        keyMissing: "No derp.server.private_key_path is configured for the embedded server.",
        serverKeyWarning:
          "HeadplaneCN only stores the path in derp.server.private_key_path; the key file itself does not have to exist yet. Headscale generates it at that path when it starts, so the directory must be writable by Headscale, and an existing file must be readable by it.",
        saveServer: "Save embedded server",
        presetButton: "Set up the embedded server",
        presetTitle: "Enable the embedded DERP server",
        presetBody:
          "This fills in the embedded server fields and enables derp.server in one save. The values are prefilled from the current configuration; review them before confirming.",
        presetConsequence:
          "Enabling the embedded server publishes a new DERP region to every client and requires the ports below to be reachable. A region code or name you already set is only replaced by what you confirm here.",
        privateKeyPathLabel: "Private key path",
        privateKeyPathDescription:
          "Absolute path of the region signing key. Headscale generates the file there when it is missing, so only the directory has to be writable by Headscale.",
        connectivityTitle: "What clients must reach",
        connectivityStun: "Clients need UDP 3478 for STUN, so they can discover their NAT mapping.",
        connectivityIpv6:
          "UDP 3478 has to be reachable for whichever address family your clients use; IPv6 firewalls are usually separate from IPv4 rules.",
        connectivityHttps:
          "server_url must use https, because the embedded relay serves DERP over TLS. Clients reach it on the same listener, usually TCP 443 (DERP over HTTPS).",
        connectivityCaptivePortal:
          "The embedded server cannot answer Tailscale's captive-portal check on TCP 80, so that check needs another service.",
        connectivityNote:
          "Clients connect to the region's public address, so its ports must be reachable through any firewall or NAT. That is the usual reason a self-hosted region never gets used.",
        regionNamesTitle: "Region names",
        regionNamesBody:
          "Headscale does not expose its DERP map, so external regions only have IDs. Name any region HeadplaneCN cannot resolve; the mapping is stored in HeadplaneCN's data directory, not in Headscale's config.",
        regionNamesEmpty: "No manual region names are configured.",
        regionNameIdLabel: "Region ID",
        regionNameIdDescription:
          "The numeric ID Tailscale reports for the region, for example 901.",
        regionNameIdPlaceholder: "901",
        regionNameValueLabel: "Region name",
        regionNameValueDescription: "The name shown next to this region ID in HeadplaneCN.",
        regionNameValuePlaceholder: "Amsterdam",
        addRegionName: "Add region name",
        removeRegionName: "Remove",
        regionNamesDialogTitle: "Add a region name",
        regionNamesDialogBody:
          "The name is shown instead of the bare ID in the relay table and on the machine detail page.",
        relaySourceLabel: "Relay source: {source}",
        relaySourceEmbeddedOnly: "only the embedded server",
        relaySourceEmbeddedAndMap: "the embedded server plus the public DERP map",
        relaySourceMapOnly: "the public DERP map only",
        relaySourceNone: "no DERP map sources are configured",
        publicPortTitle: "Public relay port",
        publicPortValue: "Clients reach this relay at {endpoint}.",
        publicPortUnknown:
          "server_url is missing or cannot be parsed, so the public relay port cannot be determined.",
        publicPortNote:
          "Tailscale's documentation recommends 443, because clients assume that port in some situations. Any other port works as long as server_url names it.",
        proxyTitle: "Behind a reverse proxy",
        proxyDerpPath: "Forward the /derp path, not only the API and control paths.",
        proxyUpgrade: "Allow the HTTP Upgrade DERP uses, and do not buffer the connection.",
        proxyTls: "Present valid HTTPS to clients.",
        proxyStun:
          "udp/3478 for STUN has to reach Headscale directly; it cannot pass through an HTTP proxy.",
        regionNamesSummary: "Named regions: {count}",
        presetClearMapLabel: "Also stop loading Tailscale's public DERP map",
        presetClearMapDescription:
          "Clears derp.urls in the same save, so clients are handed only the relay you run here.",
        presetClearMapWarning:
          "Without the public map, your embedded server becomes the only relay: if it is down or unreachable, clients cannot reach each other over DERP. Make sure clients can reach it on TCP 443 (DERP over HTTPS) and UDP 3478 (STUN).",
        mirror: {
          title: "Official region filter",
          intro:
            "The regions below are Tailscale's official DERP relays: public infrastructure run by Tailscale, not nodes you host yourself. This card mirrors that official map into a local map file and hands it to your clients, renumbering the regions into the 900s so you can keep only the ones you want. Tailscale changes those addresses over time, which is why the mirror refreshes itself.",
          summary: "{regions} official regions · {selected} selected · {file}",
          regionsBody:
            "Tick the regions clients may use. Latency comes from the HeadplaneCN Agent's measurements across the machines it can see, and from Test latency, which measures the official regions from this server. A region neither source measured stays unknown.",
          regionsEmpty:
            "No official region has been read yet. HeadplaneCN fetches Tailscale's map in the background; check that this server can reach controlplane.tailscale.com.",
          regionsUnreadable: "The official map could not be read: {reason}.",
          regionsRetry:
            "A failed fetch is retried within a few minutes; reload this page to try now.",
          fetchReasonTimeout: "the request timed out",
          fetchReasonNetwork: "the request could not be made",
          fetchReasonStatus: "the server answered with an error status",
          fetchReasonTooLarge: "the map is larger than HeadplaneCN reads",
          fetchReasonUnreadable: "the answer is not a DERP map",
          agentRequired:
            "No region has a measurement: the HeadplaneCN Agent is not running, and this server has not tested them. Tick regions by hand, or use Test latency to rank them.",
          numberingNote:
            "901 is always Hong Kong and 902 always Singapore; the rest of the ticked regions are numbered from 903 upward by measured latency, ties going to the lower official id and then to the code. A region that already has a number keeps it when you save — Renumber applies these numbers to every mirrored region.",
          rankingNever:
            "No ranking has been recorded yet, so the numbers below are a fresh ranking.",
          rankingAt: "Ranked from the latest measurements at {at}.",
          probe: "Test latency",
          probeRunning: "Testing latency…",
          probeStop: "Stop",
          probeNever: "No latency has been measured from this server yet.",
          probeMeasuredAt: "Measured from this server at {at}.",
          probeNote:
            "A measurement taken here reflects this server's own network path: a good proxy for clients nearby, not a guarantee for remote ones.",
          probePartial:
            "Some official regions did not answer from this server; those rows keep the values machines reported.",
          probeEmpty:
            "Could not probe from this server — UDP 3478 may be blocked. Falling back to the latencies the machines reported.",
          probeCancelled:
            "The measurement was stopped before it finished; the rows show whatever it had gathered.",
          latencySourceMeasured: "measured here",
          latencySourceReported: "reported by machines",
          selectedSummary: {
            one: "{count} region selected",
            other: "{count} regions selected",
          },
          sortLabel: "Sort",
          sortOfficial: "Official order",
          sortLatency: "Measured latency",
          filterLabel: "Latency below (ms)",
          filterDescription: "Hides the regions above this many milliseconds.",
          filterPlaceholder: "200",
          filterPreset: "{ms}ms",
          filterClear: "Clear filter",
          selectFiltered: "Select the regions shown",
          selectRegion: "Mirror the {code} region",
          recommended: "Recommended: the fastest three",
          selectionClear: "Clear selection",
          selectionDefault: "Default selection (Hong Kong 901 + Singapore 902)",
          addRegionNames: "Add region names for the selection",
          addingRegionNames: "Adding region names…",
          namesAdded: {
            one: "Added {count} region name",
            other: "Added {count} region names",
          },
          regionTableLabel: "Official region list",
          columnNumber: "Assigned number",
          columnName: "Chinese name",
          columnCode: "Official code",
          columnOfficialName: "Official name",
          columnNodes: "Nodes",
          columnLatency: "Measured latency",
          columnSelect: "Include",
          latencyUnknown: "Not measured",
          latencyNoMeasurements:
            "No machine and no test from this server has measured a latency yet.",
          agentSettingsLink: "Open the Agent settings",
          fixedRegion: "Always mirrored",
          currentNumber: "now {number}",
          selectionNote:
            "Ticking a region only changes this preview. Nothing is written until you save.",
          settingsTitle: "Mirror settings",
          settingsBody:
            "The mirror runs on its own schedule and writes its own file, so it never touches the rest of Headscale's configuration.",
          enabledLabel: "Enable the mirror",
          enabledDescription:
            "Fetch the official map on this schedule and write the local map file.",
          pathLabel: "Target file path",
          pathPlaceholder: "/path/to/official-mirror.yaml",
          pathDescription:
            "The local map file clients are handed. A relative path is resolved against Headscale's own config file.",
          pathNote:
            "The path has to live inside a directory mounted into the container, and this task maintains the file: edits made by hand are overwritten. Use a dedicated file such as {file}.",
          intervalLabel: "Refresh interval",
          intervalDescription: "How often the official map is fetched and compared.",
          interval6: "Every 6 hours",
          interval12: "Every 12 hours",
          interval24: "Every 24 hours",
          autoReloadLabel: "Reload after writing",
          autoReloadDescription:
            "Reload Headscale once a run actually changed the file, so clients pick up the new map without a restart.",
          autoReloadWarning: "Reloading briefly interrupts connected clients.",
          save: "Save",
          buttonsBody:
            "Run the mirror by hand, or see what a run would do before it writes anything.",
          check: "Check",
          checking: "Checking…",
          runNow: "Update now",
          running: "Updating…",
          reassign: "Renumber",
          reassigning: "Renumbering…",
          reassignTitle: "Renumber every mirrored region",
          reassignBody:
            "The selected regions are numbered again from the latest measurements, so the fastest ones move to the lowest numbers.",
          reassignWarning:
            "Clients may briefly drop and re-select their relays while the new numbers spread through the tailnet.",
          checkNote:
            "Check fetches the official map, compares it with the file on disk and shows the differences without writing anything.",
          lastRunTitle: "Last run",
          lastRunBody: "What the newest run, check or renumbering found and did.",
          never: "The mirror has not run yet.",
          reasonTitle: "Why it stopped",
          working: "The mirror is working…",
          lastRun: "Run · {at}",
          lastCheck: "Check · {at}",
          checkWroteNothing: "A check writes nothing.",
          mirroredSummary: "Regions mirrored: {regions} · nodes across them: {nodes}",
          mirroredRegion: "{code} ({nodes})",
          assignmentTitle: "Numbers this run settled on",
          assignmentLine: "{code} → {number}",
          assignmentEmpty: "No region was assigned a number.",
          fileChanged: "The local map file was replaced.",
          fileWouldChange: "The local map file would be replaced.",
          fileUnchanged: "The local map file already matches, so nothing was written.",
          reasonSelectionEmpty: "No region is selected, so there is nothing to mirror.",
          reasonFetchUnusable: "The official map could not be fetched, so nothing was mirrored.",
          reasonNoRegions: "The official map describes none of the selected regions.",
          reasonTargetRelative: "The target path is not absolute.",
          reasonTargetUnsafe: "The target path contains a .. segment.",
          reasonNotWritable: "The target file is not writable.",
          reasonValidationFailed: "The generated map was rejected by the map validator.",
          reasonReloadFailed: "Headscale could not be reloaded.",
          reasonUnexpected: "The run stopped on an unexpected error.",
          outcomeChanged: "Written",
          outcomeUnchanged: "Already up to date",
          outcomeWouldChange: "Would be written",
          outcomeSkipped: "Skipped",
          outcomeFailed: "Failed",
          reloadNotNeeded: "No reload was needed.",
          reloadManual: "Reload Headscale yourself to apply the new map.",
          reloadTriggered: "Headscale was reloaded.",
          reloadFailed: "The reload failed.",
          snapshotNote: "Snapshot taken before the write: {snapshot}",
          errors: {
            invalidDerpMirrorInterval: "Choose 6, 12 or 24 hours as the mirror interval.",
            invalidDerpMirrorPath:
              "Enter a relative file name or an absolute path for the mirrored map.",
            invalidDerpMirrorSelection:
              "The selected regions are not a list of official region ids.",
            derpMirrorSaveFailed:
              "The mirror settings could not be saved. Check that HeadplaneCN can write its data directory.",
            derpMirrorCheckFailed: "The check could not be completed.",
            derpMirrorRunFailed: "The mirror run could not be completed.",
            derpMirrorReassignFailed: "The regions could not be renumbered.",
            derpMirrorProbeBusy:
              "A latency test is already running. Stop it before starting another.",
            derpMirrorProbeFailed: "The latency test could not be completed.",
            derpMirrorUnavailable: "The region mirror is not available on this server.",
          },
        },
        relayDnsTitle: "Relay DNS resolver",
        relayDnsBody:
          "HeadplaneCN resolves the relay hostname itself so the relay cards can show the addresses clients would reach. A host resolver that filters AAAA records can make an IPv6 address look missing, so relay lookups can use DNS servers of your own instead. Leaving the list empty follows the host's resolver, exactly as before; whatever is set here is used for relay lookups only.",
        relayDnsSummary: {
          one: "{count} DNS server",
          other: "{count} DNS servers",
        },
        relayDnsEmpty:
          "No DNS servers are configured, so relay lookups follow the host's resolver.",
        relayDnsLoading: "Loading the relay DNS settings…",
        relayDnsServerLabel: "DNS server",
        relayDnsServerDescription:
          "An IPv4 or IPv6 literal with an optional port, for example 1.1.1.1 or [2606:4700:4700::1111]:53. Lookups try them in the order listed, up to {count}.",
        relayDnsServerPlaceholder: "1.1.1.1",
        relayDnsAddServer: "Add DNS server",
        relayDnsRemoveServer: "Remove",
        relayDnsStorageNote:
          "Stored in HeadplaneCN's own data directory (relay-dns-servers.json), not in Headscale's config.",
        relayDnsLookupTitle: "Relay lookup",
        relayDnsLookupBody:
          "This is the answer the relay cards show for server_url's hostname. An answer with no records is cached for five minutes, so re-resolve instead of waiting it out or restarting HeadplaneCN.",
        relayDnsReResolve: "Re-resolve now",
        relayDnsReResolving: "Re-resolving…",
        relayDnsResolverSystem: "System resolver",
        relayDnsResolverConfigured: "Configured: {servers}",
        relayDnsIpv4Label: "Resolved IPv4",
        relayDnsIpv6Label: "Resolved IPv6",
        relayDnsHostMissing:
          "server_url names no usable relay host, so there is nothing to resolve right now.",
        relayDnsSystemHint:
          "The host's resolver returned no address. Add a DNS server above and re-resolve to check whether the name really has a record: a host resolver can answer with nothing even when it does, because it filters or does not forward the query.",
        relayDnsSettingsLink: "Edit relay DNS settings",
        mapsMountTitle: "Editing needs a read-write mount",
        mapsMountBody:
          "HeadplaneCN reads and writes these files through the mounts it was given. Share only the directory holding the DERP maps, read-write, and keep the rest of Headscale's data directory out of the container:",
        mapsMountNote:
          "With the directory mounted read-only, View still works while Save reports that the container cannot write the path. Headscale itself must also be able to read these files, because it loads them when it starts.",
        mapsView: "View",
        mapsEdit: "Edit",
        mapsFromExample: "Create from example",
        mapsRollback: "Roll back",
        mapsEditorLabel: "DERP map file",
        mapsValid: "This is a valid DERP map.",
        mapsSave: "Save DERP map",
        mapsClose: "Close",
        mapsSaveNote:
          "Headscale reads derp.paths files when it starts, so a saved map takes effect after a reload or restart. The file is snapshotted before every write.",
        mapsSavedRestart:
          "Saved. Headscale reads derp.paths files at startup, so reload or restart it (Settings → System) for the change to take effect.",
        mapsSavedSnapshot:
          "A snapshot of the previous content ({snapshot}) was taken before the write; the snapshots page lists it, and Roll back restores it.",
        mapsSavedNoSnapshot:
          "There was no previous content to snapshot, so this file was created without a rollback copy.",
        mapsRolledBack:
          "Rolled back to {snapshot}. The content that was replaced was snapshotted first, and Headscale picks the file up after a reload or restart.",
        mapsStatusValid: "Valid DERP map",
        mapsTemplateIntro:
          "Each example is a complete file whose comments explain every field. Loading one replaces what is in the editor; nothing is written until you save.",
        mapsTemplateUse: "Use this example",
        pathCreateHint:
          "An absolute path on the Headscale host. Headscale and this container must both be able to read it; see the mount note above.",
        sync: {
          title: "Address auto-sync",
          body: "Keep derp.server.ipv4 and derp.server.ipv6 pointing at the addresses clients can reach. HeadplaneCN checks them on a schedule and writes Headscale's configuration file only when a value actually changed.",
          note: "IPv4 comes from the A record of server_url, because a machine behind NAT cannot know its own public address. IPv6 comes from this host's own global unicast address, or from the external echo below while it is enabled. A detection that finds nothing usable leaves the configured value exactly as it is.",
          overrideNote:
            "The detected address always wins. When it differs from derp.server.ipv4 or derp.server.ipv6, a run writes it — one key per family, and only for the family that actually changed — after taking a snapshot and recording an audit entry.",
          enabledLabel: "Sync the advertised addresses",
          enabledDescription:
            "Run both checks on the schedule below. Check and Run now work whether or not the schedule is on.",
          intervalLabel: "Check interval",
          intervalDescription:
            "How often the addresses are checked. They change slowly, so 6, 12 or 24 hours is enough.",
          interval6: "Every 6 hours",
          interval12: "Every 12 hours",
          interval24: "Every 24 hours",
          familiesLabel: "Address families",
          familiesDescription: "Which of the two advertised addresses the sync may update.",
          familyBoth: "IPv4 and IPv6",
          familyIpv4: "IPv4 only",
          familyIpv6: "IPv6 only",
          autoReloadLabel: "Reload Headscale after a change",
          autoReloadDescription:
            "On by default, so a written address takes effect immediately. Triggering the configured reload or restart briefly interrupts every connected client: turn this off to reload by hand instead. A run that changes nothing never reloads.",
          save: "Save sync settings",
          checkNow: "Check",
          checking: "Checking…",
          runNow: "Run now",
          running: "Running…",
          buttonsBody:
            "Both buttons run the same two checks: IPv4 from the A record of server_url, IPv6 from this host or from the external echo. Both report what they found, what changed or would change, and what they skipped.",
          checkNote:
            "Check writes nothing: no snapshot, no configuration change and no reload. Run now writes only the keys whose address actually changed, then follows the reload switch.",
          alertNote:
            "A failing run — a detection that finds nothing usable for a family, a write that fails, or a reload that fails — is reported through the notification settings on the Notifications page. A run that changes nothing never alerts, and an address change itself is not an alert.",
          lastRun: "Last run: {at}",
          lastCheck: "Last check: {at}",
          never: "The advertised addresses have not been checked yet.",
          checkWroteNothing: "This was a check: nothing was written and nothing was reloaded.",
          outcomeChanged: "Addresses updated",
          outcomeUnchanged: "Already up to date",
          outcomeSkipped: "Nothing to update",
          outcomeFailed: "The check failed",
          outcomeWouldChange: "Addresses would be updated",
          changesTitle: "Changes",
          wouldChangeTitle: "Would change",
          failureTitle: "Why this run failed",
          failureDetectionUnusable:
            "A detection found nothing usable for an address family, so that key was left as it is.",
          failureNotWritable:
            "The Headscale configuration file is not writable, so the changed address could not be written.",
          failureReloadFailed: "The address was written, but the automatic reload failed.",
          failureUnexpected: "The run stopped on an unexpected error.",
          failureReported: "Reported through the notification settings when they are enabled.",
          detectedTitle: "Detected",
          detectedLine: "{family}: {address} ({source})",
          changeLine: "{family}: {from} → {to}",
          changeAdded: "{family}: set to {to}",
          skippedTitle: "Skipped",
          skipFamilyDisabled: "{family}: this family is not synced.",
          skipHostMissing: "{family}: server_url names no host.",
          skipInvalidHost: "{family}: server_url is not a usable hostname.",
          skipLookupFailed: "{family}: the DNS lookup failed.",
          skipNoRecords: "{family}: the hostname has no record of that type.",
          skipNotPublic: "{family}: the address is not a public one.",
          skipNoHostAddress: "{family}: this host has no global unicast address.",
          skipNamespace: "{family}: HeadplaneCN cannot see the host's network namespace.",
          skipConfigNotWritable:
            "The Headscale configuration file is not writable, so nothing was written.",
          detectionTitle: "Detection candidates",
          detectionSummary: "{count} candidates",
          detectionBody:
            "Every address the checks considered, in ranked order, and why each was or was not chosen. Collapsed by default so this card stays compact.",
          detectionEmpty: "No detection has run yet.",
          candidateLine: "{family}: {address} — {source}, {reason}",
          candidateSelected: "chosen",
          candidateRankedLower: "usable, but another address ranked higher",
          candidateTemporary: "a rotating privacy address, so a stable one was preferred",
          candidateNotPublic: "not a usable public address, so it was rejected",
          candidateEchoWins: "overridden by the external echo answer",
          candidateExcluded: "seen on an interface but not a global unicast address",
          temporaryHint:
            "The selected IPv6 address is a temporary (privacy) address, so it rotates and will change again. Prefer a stable address on the same interface, and check derp.server.ipv6 after it changes.",
          sourceDns: "DNS A record",
          sourceHost: "host interface",
          sourceEcho: "external IPv6 echo",
          sourceLiteral: "server_url",
          reloadNotNeeded: "No reload was needed.",
          reloadManual: "Reload or restart Headscale for the change to take effect.",
          reloadTriggered:
            "Headscale was reloaded automatically; connected clients were briefly interrupted.",
          reloadFailed:
            "The automatic reload failed. Reload or restart Headscale for the change to take effect.",
          snapshotNote: "A snapshot of the previous configuration was taken first: {snapshot}.",
          echoTitle: "External IPv6 echo",
          echoBody:
            "Ask a public endpoint what IPv6 address the internet sees. That is the address clients actually reach, so while it answers it wins over every address this host holds.",
          echoEnabledLabel: "Use the external IPv6 echo",
          echoEnabledDescription:
            "Off by default. While it is on, HeadplaneCN makes one outbound IPv6 request to the endpoint below per run or check.",
          echoUrlLabel: "Echo endpoint",
          echoUrlDescription:
            "The endpoint asked first. The built-in fallbacks are tried in order when it does not answer.",
          echoNote:
            "The fallback endpoints are {urls}. The request is IPv6-only, so a host without a usable IPv6 route simply gets no answer.",
          echoPrivacy:
            "This is a request to a third party: that endpoint learns the IPv6 address this host uses to reach the internet. Nothing about it is written into Headscale's configuration, and nothing beyond the request itself is sent.",
          echoSave: "Save echo settings",
          echoSaved: "Echo settings saved.",
        },
        mapIssues: {
          position: "{message} (line {line}, column {column})",
          yamlSyntax: "This is not valid YAML.",
          derpMapTooLarge: "The file is larger than 256 KiB.",
          derpMapInvalidRoot:
            "A DERP map is a YAML mapping with a regions key, and this file is not a mapping.",
          derpMapMissingRegions: "The file has no regions key.",
          derpMapInvalidRegions: "regions must be a mapping of region id to region.",
          derpRegionInvalid:
            "Every region must be a mapping with regionid, regioncode, regionname and nodes.",
          derpRegionMissingId: "This region has no regionid.",
          derpRegionInvalidId: "regionid must be a positive integer.",
          derpRegionMissingCode: "This region has no regioncode.",
          derpRegionMissingName: "This region has no regionname.",
          derpRegionMissingNodes: "This region has no nodes list, so it relays nothing.",
          derpRegionInvalidNodes: "nodes must be a list of nodes.",
          derpRegionDuplicateId: "The region id {id} is used more than once.",
          derpRegionDuplicateCode: "The region code {code} is used more than once.",
          derpNodeInvalid: "Every node must be a mapping with name, regionid and hostname.",
          derpNodeMissingName: "This node has no name.",
          derpNodeMissingHostname: "This node has no hostname.",
          derpNodeMissingRegionId: "This node has no regionid.",
          derpNodeInvalidRegionId: "regionid must be a positive integer.",
          derpNodeRegionMismatch:
            "This node declares regionid {node}, but it is listed under region {region}.",
          derpNodeInvalidDerpPort:
            "derpport must be an integer between 1 and 65535; it defaults to {default}.",
          derpNodeInvalidStunPort:
            "stunport must be an integer between 0 and 65535, and 0 disables STUN on this node.",
          derpNodeInvalidIpv4: "ipv4 must be a bare IPv4 address such as 198.51.100.10.",
          derpNodeInvalidIpv6: "ipv6 must be a bare IPv6 address such as 2001:db8::10.",
          derpNodeInvalidStunOnly: "stunonly must be true or false.",
        },
        mapChecks: {
          exists: {
            pass: "The file exists.",
            missing: "There is no file at this path yet.",
            notFile: "This path is a directory, not a file.",
          },
          readable: {
            pass: "The file is readable.",
            fail: "The file cannot be read.",
          },
          writable: {
            pass: "The file is writable.",
            fail: "HeadplaneCN cannot write this path or the directory holding it.",
          },
          size: {
            pass: "Within the {limit} KiB editing limit.",
            fail: "Larger than the {limit} KiB limit, so it is not loaded into the editor.",
          },
          parses: {
            pass: "The YAML parses.",
            fail: "The file is not valid YAML.",
          },
          schema: {
            pass: "The document is a valid DERP map.",
            fail: "The document is not a valid DERP map.",
          },
          unique: {
            pass: "Region ids and codes are unique.",
            fail: "A region id or code is used more than once.",
          },
        },
        mapTemplates: {
          titleOneRegion: "One region, one node",
          titleTwoRegions: "Two regions, one STUN-only node",
          titleSkeleton: "Commented skeleton",
          noteOneRegion: "The smallest map Headscale accepts: a single relay region with one node.",
          noteTwoRegions:
            "Two regions where the second node only answers STUN and never relays DERP traffic.",
          noteSkeleton:
            "Every field, commented out as a reference, plus the minimal working map underneath.",
          fields: {
            regionKey:
              "regions: keyed by region id. The key has to match the regionid inside the region.",
            regionId:
              "regionid: the region's number. It must be unique across every map Headscale merges, and it should stay out of 900-999 if you run the embedded server (that defaults to 999).",
            regionCode:
              "regioncode: the short code shown in the Tailscale client, for example ams.",
            regionName: "regionname: the name clients display for this region.",
            nodeName: "name: the node's name, unique inside its region, for example 901a.",
            hostname:
              "hostname: what clients connect to. It must resolve to this machine through an A or AAAA record.",
            derpPort: "derpport: the DERP port, an integer from 1 to 65535. It defaults to 443.",
            stunPort:
              "stunport: the STUN port (UDP), an integer from 0 to 65535. It defaults to 3478, and 0 means this node does not answer STUN.",
            stunOnly:
              "stunonly: true makes a node STUN-only. It helps clients discover their NAT mapping but never relays DERP traffic.",
            ipv4: "ipv4: the node's public IPv4 address, advertised to clients so they can connect without resolving the hostname.",
            ipv6: "ipv6: the same for IPv6.",
            optional:
              "Every field is shown below, commented out, as a reference. The working minimum is at the end of the file.",
            resolve:
              "Reminder: hostname must have an A or AAAA record, otherwise no client can reach this region.",
            ports:
              "Reminder: the DERP port (TCP) and the STUN port (UDP) must be reachable through every firewall and NAT in front of this machine.",
            reload:
              "Reminder: Headscale reads derp.paths files when it starts, so reload or restart it after saving.",
          },
        },
      },
      errors: {
        invalidAction: "The request was invalid. Reload the page and try again.",
        invalidIssuer: "Enter a valid http(s) issuer URL, or leave it empty to disable OIDC.",
        invalidClientId: "An issuer requires the client ID registered with your identity provider.",
        invalidScope: "Enter at least one scope, for example openid profile email.",
        invalidPkceMethod: "Choose either plain or S256 as the PKCE method.",
        invalidCidr: "Enter a valid IPv4 or IPv6 CIDR, for example 10.0.0.0/8.",
        unspecifiedCidr:
          "Headscale treats 0.0.0.0/0 and ::/0 as a configuration error, and trusting every address would defeat the purpose of this setting.",
        duplicateProxy: "This CIDR is already in the trusted list.",
        proxyNotFound: "This CIDR is not in the trusted proxy list.",
        invalidPolicyMode: "Choose either the file or the database policy mode.",
        invalidNodeExpiry: "Enter a Headscale duration such as 720h, 30d, or 0 to never expire.",
        invalidEphemeralInactivity:
          "Enter a duration such as 30m or 120s. Headscale requires more than 65s.",
        invalidLogLevel: "Choose debug, info, warn, or error as the log level.",
        invalidLogFormat: "Choose text or json as the log format.",
        invalidBooleanValue: "This setting only accepts true or false.",
        invalidDerpUrl: "Enter a valid http(s) URL of a DERP map file.",
        duplicateDerpUrl: "This DERP map URL is already in the list.",
        derpUrlNotFound: "This DERP map URL is not in the list.",
        invalidDerpPath: "Enter the path of a DERP map file on the Headscale host.",
        duplicateDerpPath: "This DERP map path is already in the list.",
        derpPathNotFound: "This DERP map path is not in the list.",
        invalidDerpUpdateFrequency:
          "Enter a duration such as 3h or 30m. Headscale reads this with Go's duration parser.",
        invalidDerpRegionId: "Enter a region ID between 900 and 999.",
        invalidDerpRegionCode: "The embedded server needs both a region code and a region name.",
        missingDerpStunAddr:
          "Headscale requires a STUN listen address when the embedded server is enabled.",
        invalidDerpStunAddr:
          "Enter the STUN address as host:port, for example 0.0.0.0:3478 for IPv4 only or [::]:3478 for dual-stack. An IPv6-only or dual-stack tailnet needs the bracketed form, and so does Headscale's own listen_addr.",
        invalidDerpIpv4:
          "Enter a bare IPv4 address such as 198.51.100.1 without a prefix length or port, or leave it empty to unset it.",
        invalidDerpIpv6:
          "Enter a bare IPv6 address such as 2001:db8::1 without a prefix length or port, or leave it empty to unset it.",
        invalidDerpPrivateKeyPath:
          "Enter an absolute path for the private key file, for example /var/lib/headscale/derp_server_private.key.",
        invalidDerpRegionMapId: "Enter the region ID as a positive number.",
        invalidDerpRegionMapName: "Enter a name for this region.",
        derpRegionMapNotFound: "This region ID has no manual name.",
        derpRegionMapWriteFailed:
          "HeadplaneCN could not write the region name mapping. Check that its data directory is writable and try again.",
        derpPathsRequired:
          "Headscale requires at least one DERP map path when the embedded server is enabled and its region is not added automatically.",
        invalidDerpSyncInterval: "Choose 6, 12 or 24 hours as the check interval.",
        invalidDerpSyncFamilies: "Choose which address families the sync may update.",
        derpSyncSaveFailed:
          "The sync settings could not be saved. Check that HeadplaneCN can write its data directory.",
        invalidHostEchoUrl: "Enter an absolute http or https URL for the IPv6 echo endpoint.",
        hostEchoSaveFailed:
          "The echo setting could not be written to HeadplaneCN's data directory.",
        invalidOidcExtraParams:
          "Each extra parameter needs a name without spaces and a value. Remove the empty row or fill it in.",
        duplicateOidcExtraParam: "The same parameter name is used twice. Keep one row per name.",
        invalidHaProbeInterval:
          "Enter a duration of at least 2s, for example 10s, or 0 to disable HA probing.",
        invalidHaProbeTimeout: "Enter a duration of at least 1s, for example 5s.",
        invalidHaProbeCombination: "The probe timeout must be shorter than the probe interval.",
        invalidRelayDnsServer:
          "Enter a DNS server as an IPv4 or IPv6 literal with an optional port, for example 1.1.1.1 or [2606:4700:4700::1111]:53.",
        duplicateRelayDnsServer: "This DNS server is already in the list.",
        relayDnsServerLimit:
          "The list holds at most {count} DNS servers. Remove one before adding another.",
        relayDnsServerNotFound: "This DNS server is not in the list.",
        relayDnsWriteFailed:
          "HeadplaneCN could not write the relay DNS servers. Check that its data directory is writable and try again.",
        invalidDerpMapPath:
          "Enter an absolute path exactly as derp.paths lists it; a relative path, or one containing .., cannot be edited.",
        derpMapPathNotConfigured:
          "This path is not in derp.paths. Add it there first, then edit the file.",
        derpMapTooLarge:
          "This DERP map is larger than 256 KiB, which HeadplaneCN will not load or write.",
        derpMapInvalid:
          "This file is not a valid DERP map. Fix the problems listed above the save button.",
        derpMapUnavailable:
          "HeadplaneCN cannot see this path, so it cannot write it. Mount the directory holding the DERP map files into the container (see the mount note above).",
        derpMapNotWritable:
          "HeadplaneCN cannot write this path. Mount the DERP map directory read-write, and make sure the container may write the file itself.",
        derpMapWriteFailed:
          "HeadplaneCN could not write the DERP map file. Check the container's permissions and free space, then try again.",
        derpMapNoSnapshot:
          "There is no snapshot to roll back to for this file, because it has not been edited by HeadplaneCN yet.",
      },
    },
    agent: {
      title: "HeadplaneCN Agent",
      notEnabledTitle: "Agent Not Enabled",
      notEnabledBody: "{reason}. To learn how to set up the agent, visit the {link}",
      documentation: "documentation",
      statusError: "Error",
      statusWaiting: "Waiting for approval",
      statusHealthy: "Healthy",
      lastSynced: "Last synced: ",
      never: "Never",
      nodesSynced: "Nodes synced: ",
      summarySync: "Last sync {time} · {nodes} nodes",
      needsApprovalTitle: "Agent Needs Approval",
      needsApprovalBody:
        "The agent is waiting for its Tailnet registration to be approved. Open the actions below to approve it.",
      thisLink: "this link",
      syncErrorTitle: "Sync Error",
      apiKeyRejectedTitle: "Headscale rejected the configured API key",
      apiKeyRejectedBody:
        "The agent signs in with headscale.api_key from HeadplaneCN's own configuration, not with the key you logged in with, and Headscale answered 401 Unauthorized. Create a new key under {link}, put it in the configuration and restart HeadplaneCN.",
      apiKeysLink: "Settings → API keys",
      syncing: "Syncing…",
      syncNow: "Sync Now",
      actionsTitle: "Agent actions",
      actionsBody: "Sync the agent, approve a pending registration, or review the setup steps.",
      syncBody: "Fetch the latest node details from Headscale right away.",
      approveTitle: "Registration approval",
      approveBody:
        "HeadplaneCN tries to approve the registration automatically. If the agent is still waiting, open {link} to approve it yourself.",
      setupTitle: "Agent setup",
      setupRowBody: "How to install the agent and connect it to HeadplaneCN.",
      setupBody:
        "The agent runs on the Headscale server and signs in with headscale.api_key. See {link} for setup and troubleshooting.",
      lastSyncedAt: "Last synced at: ",
      cadenceBody: "The agent re-syncs every {interval}, so these details can be up to that old.",
      durationSeconds: {
        one: "{count} second",
        other: "{count} seconds",
      },
      durationMinutes: {
        one: "{count} minute",
        other: "{count} minutes",
      },
      durationHours: {
        one: "{count} hour",
        other: "{count} hours",
      },
      coverageTitle: "Sync coverage",
      coverageBody: "Which nodes reported details to the agent, and how fresh each report is.",
      coverageStatus: "{reported} of {tailnet} nodes",
      coverageStatusUnknown: "{reported} nodes",
      coverageReported: "Nodes with host information: ",
      coverageTailnet: "Nodes in the tailnet: ",
      coverageNewest: "Newest report: ",
      coverageOldest: "Oldest report: ",
      coverageMatched: "Every tailnet node has reported host information.",
      coverageMissing: {
        one: "{count} tailnet node has not reported host information yet.",
        other: "{count} tailnet nodes have not reported host information yet.",
      },
      coverageSurplus: {
        one: "The agent reported {count} node that is no longer in the tailnet.",
        other: "The agent reported {count} nodes that are no longer in the tailnet.",
      },
      coverageTailnetUnreadable:
        "The tailnet node count could not be read, so this comparison is incomplete.",
      coverageUpdatedUnreadable: "Per-node update times could not be read.",
      coverageTableNode: "Node",
      coverageTableVersion: "Version",
      coverageTableOs: "Operating system",
      coverageTableUpdated: "Last updated",
      coverageHidden: {
        one: "{count} older report is hidden.",
        other: "{count} older reports are hidden.",
      },
      coverageEmpty: "No nodes have reported host information yet.",
      coverageViewMachines: "View machines",
      runtimeTitle: "Agent runtime",
      runtimeBody: "Read-only details of how the agent is configured and where it keeps its state.",
      runtimeStatus: "Read-only",
      runtimeSummary: "{path} · every {interval}",
      runtimeExecutable: "Executable path",
      runtimeWorkDir: "Work directory",
      runtimeCacheTtl: "Cache TTL",
      runtimeCacheTtlBody:
        "HeadplaneCN serves these node details from this cache, which the agent refills every {interval}.",
      runtimeTtlUnset: "The agent falls back to its built-in interval.",
      runtimeNetns: "Tailscale netns",
      runtimeOn: "On",
      runtimeOff: "Off",
      runtimeState: "tailscaled.state",
      runtimeStateBody: "When this file exists the agent reuses its existing Tailnet identity.",
      runtimeStatePresent: "Present",
      runtimeStateMissing: "Not found",
      runtimeStateUnreadable: "The agent work directory could not be read.",
      runtimeVersion: "Agent version",
      runtimeVersionUnreadable: "The agent has not reported its own version yet.",
    },
    apiKeys: {
      breadcrumb: "API Keys",
      title: "API Keys",
      body: "API keys authenticate tools against the Headscale API. A key is only shown in full once, when it is created.",
      listTitle: "Existing keys",
      listBody: "Keys that can authenticate against the Headscale API right now.",
      summaryCount: "{count} keys",
      statusLabel: "Status",
      statusPlaceholder: "Filter by status",
      statusAll: "All",
      statusActive: "Active",
      statusExpired: "Expired",
      expiredCount: "{count} expired",
      selectAll: "Select all shown keys",
      selectKey: "Select key {prefix}",
      create: "Create API key",
      createSectionBody:
        "Create a key for a tool or script that needs to talk to the Headscale API.",
      createTitle: "Create an API key",
      createBody:
        "Choose how long this key stays valid. The key is shown once, right after it is created.",
      createAnother: "Create another key",
      expirationLabel: "Key expiration (days)",
      expirationDescription: "The key stops working after this many days.",
      createdTitle: "API key created",
      createdBody:
        "Copy this key now. It cannot be shown again after you create another key or leave the page.",
      empty: "No API keys have been created yet.",
      emptyFiltered: "No API keys match the selected filter.",
      prefix: "Prefix",
      created: "Created",
      expiration: "Expiration",
      lastSeen: "Last seen",
      never: "Never",
      expiredNote:
        "Headscale keeps this record after the key stops working and its API has no delete — expiring a key is how it is revoked.",
      expire: "Expire key",
      expireTitle: "Expire API key {prefix}?",
      expireBody:
        "Expiring this key immediately prevents it from authenticating with the Headscale API. This cannot be undone.",
      bulkActionsLabel: "Bulk key actions",
      bulkSelected: "{count} selected",
      bulkExpire: "Expire selected",
      bulkClearSelection: "Clear selection",
      bulkTitle: "Expire {count} API keys?",
      bulkBody:
        "Every selected key stops authenticating immediately, and Headscale keeps its record. This cannot be undone.",
      bulkProgress: "Expiring {done} of {total}…",
      bulkSummary: "Expired {count} API keys.",
      errors: {
        invalidExpiration: "Enter a whole number of days between 1 and 3650.",
        invalidPrefix: "The API key prefix is missing or invalid.",
        notFound: "No API key with this prefix was found. It may have already been removed.",
      },
    },
    authKeys: {
      breadcrumb: "Pre-Auth Keys",
      restrictedTitle: "Pre-auth key permissions restricted",
      restrictedBody:
        "You do not have the necessary permissions to generate pre-auth keys. Please contact your administrator to request access or to generate a pre-auth key for you.",
      missingTitle: "Missing authentication keys",
      missingBody:
        "An error occurred while fetching the authentication keys for the following users: ",
      missingFooter:
        "Their keys may not be listed correctly. Please check the server logs for more information.",
      title: "Pre-Auth Keys",
      userLabel: "User",
      userPlaceholder: "Select a user",
      all: "All",
      tagOnly: "Tag Only",
      statusLabel: "Status",
      statusPlaceholder: "Select a status",
      statusAll: "All",
      statusActive: "Active",
      statusUsedExpired: "Used/Expired",
      statusReusable: "Reusable",
      statusEphemeral: "Ephemeral",
      empty: "No pre-auth keys have been created yet.",
      emptyFiltered: "No pre-auth keys match the selected filters.",
      expiredCount: "{count} expired",
      selectAll: "Select all shown keys",
      selectKey: "Select key {key}",
      bulkActionsLabel: "Bulk pre-auth key actions",
      bulkSelected: "{count} selected",
      bulkExpire: "Expire selected",
      bulkClearSelection: "Clear selection",
      bulkTitle: "Expire {count} pre-auth keys?",
      bulkBody:
        "Every selected key stops authenticating new devices immediately, and Headscale keeps its record. This cannot be undone.",
      bulkProgress: "Expiring {done} of {total}…",
      bulkSummary: "Expired {count} pre-auth keys.",
      bulkError:
        "Some keys could not be expired. The list shows what Headscale still has; retry the ones that failed.",
    },
    authKeyRow: {
      key: "Key",
      user: "User",
      reusable: "Reusable",
      ephemeral: "Ephemeral",
      used: "Used",
      created: "Created",
      expiration: "Expiration",
      yes: "Yes",
      no: "No",
      tagOnly: "(Tag Only)",
      expiredNote:
        "Headscale keeps this record after the key stops working and its API has no delete — expiring a key is how it is revoked.",
    },
    expireKey: {
      button: "Expire Key",
      title: "Expire auth key?",
      body: "Expiring this authentication key will immediately prevent it from being used to authenticate new devices. This action cannot be undone.",
    },
    addKey: {
      create: "Create pre-auth key",
      createdTitle: "Pre-auth key created",
      createdBody: "Copy this key now. You will not be able to see the full key again.",
      registerBody: "To register a device with this key:",
      title: "Generate auth key",
      tagOnlyTitle: "Tag-only key",
      tagOnlyBody: "Create a key owned by ACL tags instead of a user.",
      tagOnlyLabel: "Tag-only",
      userDescriptionSelf: "You can only create keys for your own user.",
      userDescription: "Machines will belong to this user when they authenticate.",
      tagsDescription:
        "Comma-separated tags (e.g. server, prod). The tag: prefix is added automatically.",
      tagsLabel: "ACL Tags",
      tagsPlaceholder: "server, prod",
      expiryDescription: "Set this key to expire after a certain number of days.",
      expiryLabel: "Key Expiration",
      reusableTitle: "Reusable",
      reusableBody: "Use this key to authenticate more than one device.",
      ephemeralTitle: "Ephemeral",
      ephemeralBody:
        "Devices authenticated with this key will be automatically removed once they go offline. {link}",
    },
    restrictions: {
      breadcrumb: "Authentication Restrictions",
      restrictedTitle: "Authentication permissions restricted",
      restrictedBody:
        "You do not have the necessary permissions to edit the Authentication Restrictions settings. Please contact your administrator to request access or to make changes to these settings.",
      lockedTitle: "Configuration Locked",
      lockedBody:
        "The Headscale configuration file is not editable through the web interface. Please ensure that you have correctly given HeadplaneCN write access to the file.",
      title: "Authentication Restrictions",
      permittedDomains: "Permitted Domains",
      permittedGroups: "Permitted Groups",
      permittedUsers: "Permitted Users",
      emptyDomains: "All domains are permitted to authenticate.",
      emptyGroups: "All groups are permitted to authenticate.",
      emptyUsers: "All users are permitted to authenticate.",
      remove: "Remove",
      domainsBody:
        "Users with an email on these domains are permitted to authenticate through OIDC.",
      groupsBody: "Members of these groups are permitted to authenticate through OIDC.",
      usersBody: "Only these users are permitted to authenticate through OIDC.",
      summaryCount: "{count} allowed",
    },
    addDomain: {
      button: "Add domain",
      title: "Add domain",
      body: "Add this domain to a list of allowed email domains that can authenticate with Headscale via OIDC.",
      descriptionWithDomain: "Matches users with <user>@{domain}",
      description: "Enter a domain to match users with their email addresses.",
      duplicate: "This domain already exists in the list.",
      invalid: "This is not a valid domain.",
      label: "Domain",
      placeholder: "example.com",
    },
    addGroup: {
      button: "Add group",
      title: "Add group",
      body: "Add this group to a list of allowed groups that can authenticate with Headscale via OIDC.",
      description: "The group to allow for OIDC authentication.",
      duplicate: "This group already exists in the list.",
      label: "Group",
      placeholder: "admin",
    },
    addUser: {
      button: "Add user",
      title: "Add user",
      body: "Add this user to a list of allowed users that can authenticate with Headscale via OIDC.",
      description: "The user to allow for OIDC authentication.",
      duplicate: "This user already exists in the list.",
      label: "User",
      placeholder: "john_doe",
    },
    audit: {
      breadcrumb: "Operation Log",
      title: "Operation Log",
      body: "Every change made through HeadplaneCN is recorded here, newest first.",
      listTitle: "Recorded operations",
      listBody: "Newest first. Open an operation to see everything HeadplaneCN recorded for it.",
      retentionTitle: "Retention",
      retentionBody:
        "Only the newest {count} operations are kept; older entries are dropped automatically.",
      showingCount: "Showing {shown} of {total} operations",
      empty: "No operations match these filters.",
      loadMore: "Load more",
      filterActor: "Actor",
      filterActorPlaceholder: "Name or API key",
      filterAction: "Action",
      filterRange: "Time range",
      filterAll: "All actions",
      filterApply: "Apply filters",
      filterReset: "Reset",
      range1h: "Last hour",
      range24h: "Last 24 hours",
      range7d: "Last 7 days",
      range30d: "Last 30 days",
      rangeAll: "All time",
      resultSuccess: "Success",
      resultFailure: "Failed",
      actorType: {
        user: "User",
        apiKey: "API key",
        system: "System",
      },
      actions: {
        apiKeyCreate: "Create API key",
        apiKeyExpire: "Expire API key",
        restrictionAddDomain: "Allow domain",
        restrictionRemoveDomain: "Remove domain",
        restrictionAddGroup: "Allow group",
        restrictionRemoveGroup: "Remove group",
        restrictionAddUser: "Allow user",
        restrictionRemoveUser: "Remove user",
        derpAddressSync: "Sync DERP addresses",
        snapshotCreate: "Take snapshot",
        snapshotRestore: "Restore snapshot",
      },
      filtersTitle: "Filters",
      filtersDescription: "Choose which operations are listed.",
      summaryAll: "No filters",
      summaryActor: "actor: {actor}",
      summaryAction: "action: {action}",
      entryTitle: "Operation details",
      entryDescription: "Everything HeadplaneCN recorded for this operation.",
      detailAction: "Action",
      detailResult: "Result",
      detailTime: "Time",
      detailActor: "Actor",
      detailActorType: "Actor type",
      detailTarget: "Target",
      detailNote: "Detail",
      detailMissing: "Not recorded",
      exportCsv: "Export CSV",
      exportJson: "Export JSON",
      exportLimitNotice:
        "Exports include at most the newest {count} operations, so narrow the filters to capture everything.",
      exportColumns: {
        time: "Time",
        actor: "Actor",
        actorType: "Actor type",
        action: "Action",
        result: "Result",
        target: "Target",
        detail: "Detail",
      },
    },
    snapshots: {
      summaryFiles: "Files: {files}",
      breadcrumb: "Configuration Snapshots",
      title: "Configuration Snapshots",
      body: "HeadplaneCN copies Headscale's configuration file, and its policy file when one is used, before it changes them. A snapshot can be downloaded or restored later.",
      listTitle: "Stored snapshots",
      listBody: "Download a copy, or restore one to overwrite the live configuration.",
      summaryStored: "{count} snapshots · {size}",
      destructiveTitle: "Restoring overwrites configuration",
      destructiveBody:
        "Restoring a snapshot writes the files back to their configured paths and asks Headscale to reload. The current configuration is lost, so download a copy first if you may need it.",
      takeTitle: "Take a snapshot now",
      takeBody: "Copy the current configuration files into the snapshot directory.",
      take: "Take snapshot",
      takePending: "Taking snapshot…",
      takeSuccess: "Snapshot created.",
      storedAt: "Snapshots are stored in {path}",
      totalSize: "{size} total",
      restore: "Restore",
      restoreTitle: "Restore this snapshot?",
      restoreBody: "This overwrites {files} with the contents from {time}. This cannot be undone.",
      empty: "No snapshots have been taken yet.",
      reasons: {
        manual: "Manual snapshot",
        restrictionChange: "Authentication restrictions changed",
      },
      errors: {
        notFound: "That snapshot or file no longer exists.",
        unexpectedPath:
          "The snapshot does not belong to the configured configuration file, so nothing was restored.",
        noTargets:
          "No Headscale configuration file is configured, so there is nothing to snapshot.",
        unavailable:
          "The snapshot directory could not be used. Check that HeadplaneCN can write to its data directory.",
        copyFailed: "None of the configuration files could be read.",
      },
      dataBackup: {
        title: "Download HeadplaneCN data",
        body: "Configuration snapshots cover Headscale's configuration and policy files, and this page can restore them. This download covers HeadplaneCN itself: its own database, copied consistently while HeadplaneCN keeps running.",
        contentsTitle: "What the copy contains",
        contents:
          "HeadplaneCN's own database: local users and their sessions, the audit log, and the host information reported by the HeadplaneCN agent.",
        excludesTitle: "What the copy does not contain",
        excludes:
          "Secrets stay in config.yaml: cookie_secret and headscale.api_key are never written into the database. Data HeadplaneCN keeps in files beside the database, such as snapshot metadata, notification settings and delivery history, and node history, is not included either.",
        noRestore:
          "There is no one-click restore. Keep the file somewhere safe and put it back by hand if you ever need it.",
        download: "Download data backup",
        errors: {
          copyFailed:
            "HeadplaneCN's database could not be copied. Check the server logs and try again.",
          unavailable:
            "The backup could not be written to a temporary file. Check that the server has space in its temporary directory.",
        },
      },
    },
    notifications: {
      breadcrumb: "Alert Notifications",
      title: "Alert Notifications",
      body: "HeadplaneCN checks Headscale on a schedule and posts to a webhook when something changes: Headscale becoming unreachable, a node going offline, an API key about to expire, or a configuration check failing.",
      statusEnabled: "Enabled",
      statusDisabled: "Disabled",
      statusNever: "No deliveries yet",
      statusLastOk: "Last delivery succeeded",
      statusLastFailed: "Last delivery failed",
      failureTitle: "The last delivery failed",
      failureBody:
        "The webhook did not accept the last notification. Check the URL, the secret, and whether the endpoint is reachable from this server.",
      channelTitle: "Webhook channel",
      channelBody: "Notifications are sent as a JSON POST to a single endpoint.",
      channelSummaryEmpty: "No webhook configured",
      enabledLabel: "Enable notifications",
      enabledDescription: "While disabled, HeadplaneCN detects changes but sends nothing.",
      enabledOn: "On",
      enabledOff: "Off",
      webhookUrlLabel: "Webhook URL",
      webhookUrlDescription: "Must be an absolute http or https URL.",
      secretLabel: "Shared secret",
      secretDescription: "Optional. Sent as the X-Headplane-Secret header on every delivery.",
      save: "Save",
      saving: "Saving…",
      saved: "Saved.",
      test: "Send test",
      testing: "Sending…",
      testBody: "Post a sample payload right now and report the result.",
      testOk: "Delivered (HTTP {status})",
      testFailed: "Not delivered (HTTP {status})",
      eventsTitle: "Reported events",
      eventsBody:
        "Each event is reported once per change, and repeating is limited by the cooldown.",
      eventsSummary: "{count} selected",
      eventsLabel: "Events",
      eventsDescription: "Unchecked events are still detected, but never sent.",
      intervalLabel: "Check interval (seconds)",
      intervalDescription: "How often HeadplaneCN looks for changes.",
      cooldownLabel: "Cooldown (seconds)",
      cooldownDescription: "Shortest time before the same condition is reported again.",
      expiryLabel: "API key warning window (days)",
      expiryDescription: "Warn this many days before an API key expires.",
      historyTitle: "Delivery history",
      historyBody: "The most recent webhook attempts, newest first.",
      historySummary: "{count} deliveries",
      historyEmpty: "Nothing has been delivered yet.",
      historyOk: "Delivered",
      historyFailed: "Failed",
      historyStatus: "HTTP {status}",
      historyThreshold: "{days} day window",
      eventHeadscaleUnreachable: "Headscale unreachable",
      eventHeadscaleRecovered: "Headscale recovered",
      eventNodeOffline: "Node went offline",
      eventNodeOnline: "Node came back online",
      eventApiKeyExpiring: "API key expiring",
      eventConfigCheckFailed: "Configuration check failed",
      eventDerpSyncFailed: "DERP address sync failed",
      eventTest: "Test notification",
      errors: {
        invalidAction: "The request was not understood.",
        invalidUrl: "Enter an absolute http or https webhook URL.",
        invalidInterval: "The check interval is outside the allowed range.",
        invalidCooldown: "The cooldown is outside the allowed range.",
        invalidExpiry: "The API key warning window is outside the allowed range.",
        noEvents: "Select at least one event to report.",
        notConfigured: "Set a webhook URL before enabling or testing notifications.",
        writeFailed: "The settings could not be written to HeadplaneCN's data directory.",
      },
    },
  },
  ssh: {
    nodeOffline: {
      title: "Node Offline",
      body: "{hostname} is not currently connected to the Tailnet.",
      retry: "Retry Connection",
    },
    compat: {
      title: "Browser SSH is broken on Headscale {version}",
      body: "Headscale 0.29 beta releases through 0.29.1 reject Tailscale's browser/WASM {ts2021} WebSocket request with {methodNotAllowed}. Upgrade Headscale to 0.29.2 or newer, or use Headscale 0.28.x.",
    },
    joining: "Joining Tailnet…",
    connecting: "Connecting to {hostname}…",
    nodeStopped: "Tailnet node stopped: {error}",
    joinFailed: "Failed to join Tailnet: {error}",
    prompt: {
      title: "Enter Username",
      body: "Enter the username you want to use to connect to {hostname}. SSH via the web follows the same ACL rules as regular SSH access in Headscale, so only permitted usernames will work. See the {link} for common errors.",
      troubleshooting: "troubleshooting guide",
      usernameLabel: "Username",
      connect: "Connect",
    },
    docs: "HeadplaneCN SSH Documentation",
    errors: {
      wasmMissing: {
        title: "Browser SSH is not available",
        message: "This version of HeadplaneCN was not built with browser SSH support.",
      },
      agentRequired: {
        title: "Browser SSH requires the HeadplaneCN agent",
        message: "Browser SSH is only available when the HeadplaneCN agent integration is enabled.",
      },
      oidcRequired: {
        title: "Browser SSH requires OIDC authentication",
        message: "Browser SSH is only available when OIDC authentication is enabled.",
      },
      nodeNotFound: {
        title: "Node not found",
        message: "No node found with hostname {hostname}.",
      },
      userNotLinked: {
        title: "User account not linked",
        message:
          "You'll need to link your user account to a Headscale user before you can use Browser SSH.",
      },
    },
  },
  home: {
    linkedTo: "Your account is linked to Headscale user {name}.",
    title: "Access your network via Tailscale",
    body: "You've successfully authenticated but don't have access to the dashboard. You can still connect to your Headscale network by installing Tailscale.",
    viewScript: "View script source",
    unlinked:
      "Your account isn't linked to a Headscale user. Ask your administrator to create one for you.",
    noAccess: "Need access to the dashboard? Contact your administrator to request access.",
    link: {
      title: "Link your Headscale account",
      body: "HeadplaneCN could not automatically match your SSO identity to an existing Headscale user. Please select your user from the list below to link your account and continue.",
      selectPlaceholder: "Select a user...",
      button: "Link and Continue",
      footer:
        "If you don't see your user listed, please contact your administrator. To automatically link new users in the future, ensure that the Headscale user has the same email address as the SSO identity.",
    },
  },
  pages: {
    Machines: "Machines",
    Users: "Users",
    "Access Control": "Access Control",
    DNS: "DNS",
    Settings: "Settings",
    unavailableTitle: "{page} Unavailable",
    unavailableBody:
      "This page could not be loaded because the Headscale server is unreachable. It will be available once the connection is restored.",
  },
  login: {
    welcome: "Welcome to HeadplaneCN",
    apiKeyDescription:
      "Enter an API key to authenticate with HeadplaneCN. You can generate one by running {command} in your terminal.",
    apiKeyLabel: "API Key",
    signIn: "Sign In",
    sso: "Single Sign-On",
    cookieWarning: {
      title: "Configuration Issue",
      body: "HeadplaneCN is configured to use secure cookies, but this site is being served over an insecure connection and login will not work correctly. {link}",
    },
    logout: {
      title: "You have been logged out",
      body: "You can now close this window. If you would like to log in again, please refresh the page.",
    },
    errors: {
      missingKey: "Missing API key. Please enter your API key.",
      emptyKey: "API key cannot be empty. Please enter a valid API key.",
      notFound: "API key was not found in the Headscale database",
      malformed: "API key is malformed (missing expiration). Please generate a new API key.",
      expired: "API key has expired",
      invalid: "API key is invalid (it may be incorrect or expired)",
      unknown: "Error while validating API key (see logs for details)",
    },
    oidcNotice: {
      title: "Configuration Issue(s)",
      noQuery:
        "The SSO provider did not correctly redirect back to HeadplaneCN with the required parameters. Please ensure your SSO provider is configured correctly.",
      noSession:
        "Unable to complete SSO login due to missing or invalid session data. Ensure that your HeadplaneCN cookie configuration is correct and that your browser is accepting cookies.",
      noSub:
        "The SSO provider did not return a valid user identifier. Please ensure your SSO provider is correctly configured to provide the {claim} claim.",
      authFailed:
        "Authentication with the SSO provider failed. Please try again later. HeadplaneCN logs may provide more information.",
      unknown: "An unknown error occurred during OIDC authentication. Please try again later.",
    },
    oidcConfig: {
      discoveryTitle: "SSO Temporarily Unavailable",
      discoveryBody:
        "Unable to reach the identity provider. Single Sign-On will be available once the provider is reachable again. You can still sign in with an API key.",
      errorTitle: "Authentication Error",
      errorIntro: "The OpenID Connect (OIDC) Single Sign-On (SSO) configuration has issues:",
      invalidApiKey:
        "The provided API key for OIDC authentication is invalid. Ensure that {config} is a valid API key.",
      missingEndpoints:
        "The OIDC provider is missing required endpoints. Ensure the discovery URL is correct or provide manual endpoint overrides in your configuration.",
      discoveryFailed:
        "Unable to reach the OIDC provider for discovery. SSO will retry on the next login attempt.",
      unknown:
        "An unknown OIDC configuration error occurred. Please check the HeadplaneCN logs for more information.",
    },
  },
  errors: {
    headscaleConfigNotWritable:
      "HeadplaneCN cannot write to the Headscale configuration file. Mount it read-write and restart HeadplaneCN.",
    policyNotWritable:
      "Headscale is reading its ACL policy from a file, so the policy cannot be saved through the API. Ask your administrator to run Headscale with the `database` policy mode, or edit the policy file directly.",
    generic: {
      requestFailed: "There was an error processing your request.",
      statusCode: "Status Code",
      statusText: "Status Text",
      withStatus: "Error {status}",
      withName: "Error: {name}",
      title: "Error",
    },
    api: {
      serverTitle: "Headscale API Error",
      serverBody:
        "There was an error communicating with the Headscale API. The server responded with a status code of {status}, indicating a server-side issue. Please check the Headscale server status and try again later.",
      invalidTitle: "Invalid response from Headscale API",
      invalidBody: "The Headscale API returned an unexpected response.",
      invalidAuth:
        "The status code indicates an authentication error. Please verify your API key and HeadplaneCN configuration.",
      invalidOther: "You may be using an unsupported version of Headscale or this may be a bug.",
      requestUrl: "Request URL:",
      statusCodeLabel: "Status Code:",
      connectionTitle: "Cannot connect to Headscale API",
      connectionBody:
        "HeadplaneCN was unable to reach the Headscale API. Please check your network setup and configuration to ensure HeadplaneCN is able to connect.",
      unexpectedTitle: "Unexpected Error",
      unexpectedBody:
        "An unexpected error occurred which is most likely a bug. Please consider filing an issue on the {link} repository with the details below.",
      unexpectedLink: "HeadplaneCN GitHub",
      details: "Error Details",
    },
    permission: {
      view: "You do not have permission to view this page. Please contact your administrator.",
      readPolicy: "You do not have permission to read the ACL policy.",
      writePolicy: "You do not have permission to write to the ACL policy",
      manageMachines: "You do not have permission to manage machines",
      actOnMachine: "You do not have permission to act on this machine",
      updateUsers: "You do not have permission to update users",
      managePreAuthKeys: "You do not have permission to manage pre-auth keys",
      manageUserPreAuthKeys: "You do not have permission to manage this user's pre-auth keys",
      viewIam: "You do not have permission to view IAM settings.",
      modifyIam: "You do not have permission to modify IAM settings.",
    },
    staleShell: {
      title: "Page is out of date",
      body: "HeadplaneCN was updated while this page was open, so the browser is still using an older version of the page and cannot load the files it asks for. Reloading fetches the current version.",
      hint: "If this page keeps coming back, do a hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on macOS) to bypass your reverse proxy cache.",
      reload: "Reload page",
    },
  },
  notFound: {
    title: "Page Not Found",
    body: "The page you are looking for does not exist or may have been moved.",
    back: "Go to machines",
  },
} as const;

export default en;
