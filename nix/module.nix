{
  config,
  lib,
  pkgs,
  ...
}: let
  inherit
    (lib)
    filterAttrs
    filterAttrsRecursive
    mkIf
    recursiveUpdate
    updateManyAttrsByPath
    ;
  cfg = config.services.headplane;
  settingsFormat = pkgs.formats.yaml {};
  settingsWithAgentExecutablePath = recursiveUpdate cfg.settings {
    integration.agent.executable_path = "${cfg.settings.integration.agent.package}/bin/hp_agent";
  };
  settingsWithoutAgentPackage =
    updateManyAttrsByPath [
      {
        path = ["integration" "agent"];
        update = old: filterAttrs (key: value: key != "package") old;
      }
    ]
    settingsWithAgentExecutablePath;
  settingsWithoutDisabledIntegrations =
    updateManyAttrsByPath [
      {
        path = ["integration" "docker"];
        update = old: if (old.enabled or false) then old else null;
      }
      {
        path = ["integration" "kubernetes"];
        update = old: if (old.enabled or false) then old else null;
      }
    ]
    settingsWithoutAgentPackage;
  settingsWithoutNulls = filterAttrsRecursive (key: value: value != null) settingsWithoutDisabledIntegrations;
  settingsWithoutEmptyOidc = 
    if settingsWithoutNulls ? oidc && 
       ((settingsWithoutNulls.oidc.issuer or "") == "" && (settingsWithoutNulls.oidc.client_id or "") == "") then
      builtins.removeAttrs settingsWithoutNulls ["oidc"]
    else
      settingsWithoutNulls;
  settingsFile = settingsFormat.generate "headplane-config.yaml" settingsWithoutEmptyOidc;
in {
  imports = [./options.nix];
  config = mkIf cfg.enable {
    assertions = [
      {
        assertion = !cfg.settings.integration.kubernetes.enabled || cfg.settings.integration.kubernetes.pod_name != null;
        message = ''
          services.headplane.settings.integration.kubernetes.pod_name must name the
          Headscale pod when the Kubernetes integration is enabled.
        '';
      }
    ];

    environment = {
      systemPackages = [cfg.package];
      etc."headplane/config.yaml".source = "${settingsFile}";
    };

    systemd.services.headplane = {
      description = "Headscale Web UI";

      wantedBy = ["multi-user.target"];
      after = ["headscale.service"];
      requires = ["headscale.service"];

      environment = {HEADPLANE_DEBUG_LOG = builtins.toString cfg.debug;};

      serviceConfig = {
        User = config.services.headscale.user;
        Group = config.services.headscale.group;
        StateDirectory = "headplane";

        # The Docker integration needs the socket, which is owned by the docker
        # group. Only add it when that group exists.
        SupplementaryGroups =
          lib.optional
          (cfg.settings.integration.docker.enabled && config.users.groups ? docker)
          "docker";

        ExecStart = "${cfg.package}/bin/headplane";
        Restart = "always";
        RestartSec = 5;

        # TODO: Harden `systemd` security according to the "The Principle of Least Power".
        # See: `$ systemd-analyze security headplane`.
      };
    };
  };
}
