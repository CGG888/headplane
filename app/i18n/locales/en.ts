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
    logoAlt: "Headplane logo",
    tabs: {
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
    logout: "Logout",
  },
  footer: {
    sponsor: "Headplane is free and open-source. Please consider {link} to support development.",
    sponsorLink: "sponsoring",
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
      magicDnsTooltip:
        "Since MagicDNS is enabled, you can access devices based on their name and also at {code}",
      actions: "Actions",
      empty: "No machines match the current filters",
    },
    detail: {
      allMachines: "All Machines",
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
        "Whether the machine is behind a difficult NAT that varies the machine’s IP address depending on the destination.",
      hairpinning: "Hairpinning",
      hairpinningTooltip: "Whether the machine needs to traverse NATs with hairpinning.",
      ipv6: "IPv6",
      udp: "UDP",
      upnp: "UPnP",
      pcp: "PCP",
      natPmp: "NAT-PMP",
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
      body: "This will disconnect the machine from your Tailnet. In order to reconnect, you will need to re-authenticate from the device.",
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
      tailscaleSsh: "Tailscale SSH",
      tailscaleSshTooltip:
        "This machine advertises Tailscale SSH, which allows you to authenticate SSH credentials using your Tailscale account and via the Headplane web UI.",
      agent: "Headplane Agent",
      agentTooltip:
        "This machine is running the Headplane agent, which allows it to provide host information in the web UI.",
    },
  },
  users: {
    list: {
      title: "Users",
      subtitle: "Manage the users in your network and their permissions.",
      headplaneSection: "Headplane Users",
      empty: "No users have signed into Headplane yet.",
      columnUser: "User",
      columnRole: "Role",
      columnLastLogin: "Last Login",
      columnStatus: "Status",
      columnCreatedAt: "Created At",
      actions: "Actions",
      unlinkedSection: "Unlinked Headscale Users",
      unlinkedBody:
        "These Headscale users are not linked to a Headplane account and cannot be managed through Headplane.",
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
      body: "This creates a new user in Headscale. The user will appear in the “Unlinked Headscale Users” section until they sign in and are automatically linked to a Headplane account.",
      bodyOidc:
        "This creates a new user in Headscale. The user will appear in the “Unlinked Headscale Users” section until they sign in through your OIDC provider and are automatically linked to a Headplane account.",
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
      body: "Roles control what the user can access in Headplane. Each role grants a specific set of capabilities.",
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
      body: "This will make {name} the new owner of this Headplane instance. You will be demoted to an Admin. This action cannot be easily undone.",
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
        "Alternatively, you can switch Headscale to use {database} mode for ACLs by updating your Headscale configuration. This will allow Headplane to manage the ACL policy directly through the web interface.",
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
      actionUnknown: "{action} — not known to Headplane",
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
      body: "The settings page is still under construction. As I'm able to add more features, I'll be adding them here. If you require any features, feel free to open an issue on the GitHub repository.",
      preAuthTitle: "Pre-Auth Keys",
      preAuthBody:
        "Headscale fully supports pre-authentication keys in order to easily add devices to your Tailnet. To learn more about using pre-authentication keys, visit the {link}",
      tailscaleDocs: "Tailscale documentation",
      manageAuthKeys: "Manage Auth Keys",
      agentTitle: "Headplane Agent",
      agentBody:
        "The Headplane Agent syncs node information like OS version and connectivity details from your Tailnet.",
      agentSettings: "Agent Settings",
      restrictionsTitle: "Authentication Restrictions",
      restrictionsBody:
        "Headscale supports restricting OIDC authentication to only allow certain email domains, groups, or users to authenticate. This can be used to limit access to your Tailnet to only certain users or groups and Headplane will also respect these settings when authenticating. {link}",
      manageRestrictions: "Manage Restrictions",
    },
    agent: {
      title: "Headplane Agent",
      notEnabledTitle: "Agent Not Enabled",
      notEnabledBody: "{reason}. To learn how to set up the agent, visit the {link}",
      documentation: "documentation",
      statusError: "Error",
      statusWaiting: "Waiting for approval",
      statusHealthy: "Healthy",
      lastSynced: "Last synced: ",
      never: "Never",
      nodesSynced: "Nodes synced: ",
      needsApprovalTitle: "Agent Needs Approval",
      needsApprovalBody:
        "The agent is waiting for its Tailnet registration to be approved. Headplane will attempt to auto-approve it, but if that fails, you can complete approval by visiting {link}.",
      thisLink: "this link",
      syncErrorTitle: "Sync Error",
      syncing: "Syncing…",
      syncNow: "Sync Now",
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
        "The Headscale configuration file is not editable through the web interface. Please ensure that you have correctly given Headplane write access to the file.",
      title: "Authentication Restrictions",
      permittedDomains: "Permitted Domains",
      permittedGroups: "Permitted Groups",
      permittedUsers: "Permitted Users",
      emptyDomains: "All domains are permitted to authenticate.",
      emptyGroups: "All groups are permitted to authenticate.",
      emptyUsers: "All users are permitted to authenticate.",
      remove: "Remove",
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
    docs: "Headplane SSH Documentation",
    errors: {
      wasmMissing: {
        title: "Browser SSH is not available",
        message: "This version of Headplane was not built with browser SSH support.",
      },
      agentRequired: {
        title: "Browser SSH requires the Headplane agent",
        message: "Browser SSH is only available when the Headplane agent integration is enabled.",
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
      body: "Headplane could not automatically match your SSO identity to an existing Headscale user. Please select your user from the list below to link your account and continue.",
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
    welcome: "Welcome to Headplane",
    apiKeyDescription:
      "Enter an API key to authenticate with Headplane. You can generate one by running {command} in your terminal.",
    apiKeyLabel: "API Key",
    signIn: "Sign In",
    sso: "Single Sign-On",
    cookieWarning: {
      title: "Configuration Issue",
      body: "Headplane is configured to use secure cookies, but this site is being served over an insecure connection and login will not work correctly. {link}",
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
        "The SSO provider did not correctly redirect back to Headplane with the required parameters. Please ensure your SSO provider is configured correctly.",
      noSession:
        "Unable to complete SSO login due to missing or invalid session data. Ensure that your Headplane cookie configuration is correct and that your browser is accepting cookies.",
      noSub:
        "The SSO provider did not return a valid user identifier. Please ensure your SSO provider is correctly configured to provide the {claim} claim.",
      authFailed:
        "Authentication with the SSO provider failed. Please try again later. Headplane logs may provide more information.",
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
        "An unknown OIDC configuration error occurred. Please check the Headplane logs for more information.",
    },
  },
  errors: {
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
        "The status code indicates an authentication error. Please verify your API key and Headplane configuration.",
      invalidOther: "You may be using an unsupported version of Headscale or this may be a bug.",
      requestUrl: "Request URL:",
      statusCodeLabel: "Status Code:",
      connectionTitle: "Cannot connect to Headscale API",
      connectionBody:
        "Headplane was unable to reach the Headscale API. Please check your network setup and configuration to ensure Headplane is able to connect.",
      unexpectedTitle: "Unexpected Error",
      unexpectedBody:
        "An unexpected error occurred which is most likely a bug. Please consider filing an issue on the {link} repository with the details below.",
      unexpectedLink: "Headplane GitHub",
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
  },
  notFound: {
    title: "Page Not Found",
    body: "The page you are looking for does not exist or may have been moved.",
    back: "Go to machines",
  },
} as const;

export default en;
