import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  SECTION_LABELS,
  TRIGGER_MODES,
  MVP_TRIGGER_MODE_IDS,
  DEFAULT_TRIGGER_CONFIG,
  ROLES
} from "./settingsData.js";
import {
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  getWorkspaceId,
  onApiUnauthorized
} from "./settingsClient.js";
import ConnectSignalSourceModal from "./ConnectSignalSourceModal.jsx";
import { getSafeApiBase } from "../../lib/apiBase.js";
import { normalizeStoredProject, primaryCertEnvFromTiers } from "../../lib/projectEnv.js";
import {
  readWorkspaceProdObservation,
  writeWorkspaceProdObservation
} from "../../lib/workspacePrefs.js";
import {
  cloneSourcesBase,
  mergeSourcesFromApi,
  loadRolePolicy,
  hasConnectedSignalSource,
  isEvalSourceConnected,
  isThresholdsConfiguredFromApi,
  isReleaseTriggerReady
} from "./workspace/settingsWorkspaceModel.js";
import {
  slugifyWorkspaceSlug,
  normalizeApiBaseOrigin
} from "./workspace/settingsSaveTransforms.js";
import SettingsWorkspaceShell from "./workspace/SettingsWorkspaceShell.jsx";
import GovernancePanel from "./workspace/GovernancePanel.jsx";
import GeneralSettingsSection from "./workspace/sections/GeneralSettingsSection.jsx";
import TeamSettingsSection from "./workspace/sections/TeamSettingsSection.jsx";
import ApiSignalSection from "./workspace/sections/ApiSignalSection.jsx";
import AgentAccessSection from "./workspace/sections/AgentAccessSection.jsx";
import TriggerSettingsSection from "./workspace/sections/TriggerSettingsSection.jsx";
import NotificationsSettingsSection from "./workspace/sections/NotificationsSettingsSection.jsx";
import BillingSettingsSection from "./workspace/sections/BillingSettingsSection.jsx";
import DangerZoneSection from "./workspace/sections/DangerZoneSection.jsx";
import EmailPreviewsSection from "./workspace/sections/EmailPreviewsSection.jsx";

export default function SettingsWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();
  const contentRef = useRef(null);
  const [section, setSection] = useState("general");
  const [toastMsg, setToastMsg] = useState("");
  const [toastShow, setToastShow] = useState(false);
  const toastTimer = useRef(null);

  const wsId = getWorkspaceId();

  const [triggerConfig, setTriggerConfig] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("vdk3_trigger") || "null") || { ...DEFAULT_TRIGGER_CONFIG };
    } catch (_) {
      return { ...DEFAULT_TRIGGER_CONFIG };
    }
  });
  const [triggerDirty, setTriggerDirty] = useState(false);
  const [vcsCfg, setVcsCfg] = useState(null);
  const [vcsForm, setVcsForm] = useState({ provider: "github", access_token: "", owner: "", repo: "" });
  const [vcsSaving, setVcsSaving] = useState(false);
  const [githubAppStatus, setGithubAppStatus] = useState({
    configured: false,
    connected: false,
    installation: null,
    selected_repo_count: 0
  });
  const [githubRepos, setGithubRepos] = useState([]);
  const [githubReposLoading, setGithubReposLoading] = useState(false);

  const orgName = (localStorage.getItem("vdk3_org") || "").trim() || "Workspace";
  const [generalSlug, setGeneralSlug] = useState(
    () => localStorage.getItem("vdk3_workspace_slug") || slugifyWorkspaceSlug(orgName) || "workspace"
  );
  const [apiBaseInput, setApiBaseInput] = useState(() =>
    import.meta.env.DEV ? localStorage.getItem("vdk3_api_base") || "" : getSafeApiBase() || ""
  );
  const [generalNote, setGeneralNote] = useState("No unsaved changes");
  const [generalDirty, setGeneralDirty] = useState(false);

  const [envChip, setEnvChip] = useState(() => {
    try {
      const raw = localStorage.getItem("vdk3_project");
      if (!raw) return "uat";
      const parsed = JSON.parse(raw);
      const n = normalizeStoredProject(parsed);
      return primaryCertEnvFromTiers(n.certEnvs) === "staging" ? "staging" : "uat";
    } catch (_) {
      return "uat";
    }
  });

  const [prodObservation, setProdObservation] = useState(() => readWorkspaceProdObservation(wsId));

  useEffect(() => {
    setProdObservation(readWorkspaceProdObservation(wsId));
  }, [wsId]);

  const persistProdObservation = (next) => {
    setProdObservation(next);
    writeWorkspaceProdObservation(wsId, next);
    toast(next ? "Production observation on — post-deploy intelligence enabled" : "Production observation off");
  };

  const [certVisibility, setCertVisibility] = useState({
    public_cert_records: true,
    show_signal_detail: true,
    show_override_justification: true
  });
  const [slackWebhookInput, setSlackWebhookInput] = useState("");
  const [slackSaving, setSlackSaving] = useState(false);

  const [members, setMembers] = useState(() => []);
  const [membersLoading, setMembersLoading] = useState(false);
  const [rolePolicy, _setRolePolicy] = useState(loadRolePolicy);

  const [sources, setSources] = useState(() => cloneSourcesBase());
  const [signalPanel, setSignalPanel] = useState(null);
  const [signalPanelLoading, setSignalPanelLoading] = useState(true);
  const [signalPanelError, setSignalPanelError] = useState(null);
  const [workspaceThresholds, setWorkspaceThresholds] = useState(null);
  const [connectModal, setConnectModal] = useState(null);
  const csvInputRef = useRef(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("ai_product_lead");
  const projectName = (() => {
    try {
      const raw = localStorage.getItem("vdk3_project");
      if (!raw) return "Project";
      const parsed = JSON.parse(raw);
      return (parsed?.name && String(parsed.name).trim()) || "Project";
    } catch (_) {
      return "Project";
    }
  })();

  const sidebarUser = useMemo(() => {
    try {
      const raw = localStorage.getItem("vdk3_currentUser");
      if (!raw) return { initials: "?", name: "Account", email: "" };
      const u = JSON.parse(raw);
      const em = String(u.email || "");
      return {
        initials: u.initials || (em ? em.slice(0, 2).toUpperCase() : "?"),
        name: u.name || (em ? em.split("@")[0] : "Account"),
        email: em
      };
    } catch {
      return { initials: "?", name: "Account", email: "" };
    }
  }, []);

  const toast = useCallback((msg) => {
    setToastMsg(String(msg ?? ""));
    setToastShow(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastShow(false), 3000);
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    try {
      localStorage.removeItem("vdk3_api_base");
    } catch (_) {}
  }, []);

  const roleLabels = useMemo(() => Object.fromEntries(Object.entries(rolePolicy).map(([id, cfg]) => [id, cfg.label])), [rolePolicy]);

  const loadSignalSources = useCallback(async () => {
    setSignalPanelLoading(true);
    setSignalPanelError(null);
    try {
      const data = await apiGet(`/api/workspaces/${wsId}/signal-integrations`, { navigate });
      setSources(mergeSourcesFromApi(cloneSourcesBase(), data));
      setSignalPanel({
        pull_connectors: data.pull_connectors || [],
        push_sources: data.push_sources || [],
        integration_requests: data.integration_requests || [],
        api_push: data.api_push || {},
        csv_import: data.csv_import || null
      });
    } catch (e) {
      setSignalPanelError(e?.message || "Failed to load signal sources");
    } finally {
      setSignalPanelLoading(false);
    }
  }, [navigate, wsId]);

  useEffect(() => {
    loadSignalSources();
  }, [loadSignalSources]);

  const loadWorkspaceThresholds = useCallback(async () => {
    try {
      const data = await apiGet(`/api/workspaces/${wsId}/thresholds`, { navigate });
      setWorkspaceThresholds(data?.thresholds ?? null);
    } catch {
      setWorkspaceThresholds(null);
    }
  }, [navigate, wsId]);

  useEffect(() => {
    loadWorkspaceThresholds();
  }, [loadWorkspaceThresholds]);

  useEffect(() => {
    if (!wsId) return;
    let active = true;
    apiGet(`/api/workspaces/${wsId}/policies`, { navigate })
      .then((data) => {
        if (!active) return;
        const p = data?.policies;
        if (!p) return;
        setCertVisibility({
          public_cert_records: p.public_cert_records !== false,
          show_signal_detail: p.show_signal_detail !== false,
          show_override_justification: p.show_override_justification !== false
        });
        setSlackWebhookInput(p.slack_webhook_url || "");
      })
      .catch(() => {});
    return () => { active = false; };
  }, [wsId, navigate]);

  const updateCertVisibility = useCallback(
    async (key, value) => {
      const next = { ...certVisibility, [key]: value };
      setCertVisibility(next);
      try {
        await apiPost(`/api/workspaces/${wsId}/policies`, next, { navigate });
      } catch (err) {
        setCertVisibility(certVisibility);
        toast(err?.message || "Failed to save visibility setting");
      }
    },
    [certVisibility, navigate, toast, wsId]
  );

  const saveSlackWebhook = useCallback(async () => {
    setSlackSaving(true);
    try {
      await apiPost(
        `/api/workspaces/${wsId}/policies`,
        { slack_webhook_url: slackWebhookInput.trim() || null },
        { navigate }
      );
      toast(slackWebhookInput.trim() ? "Slack webhook saved" : "Slack webhook removed");
    } catch (err) {
      toast(err?.message || "Failed to save Slack webhook");
    } finally {
      setSlackSaving(false);
    }
  }, [navigate, slackWebhookInput, toast, wsId]);

  const resetThresholdsToDefaults = useCallback(async () => {
    try {
      const { THRESH_DEFAULTS } = await import("./settingsData.js");
      const thresholds = Object.fromEntries(
        Object.entries(THRESH_DEFAULTS).map(([k, v]) => [k, { min: v, max: null }])
      );
      await apiPost(`/api/workspaces/${wsId}/thresholds`, { thresholds }, { navigate });
      await loadWorkspaceThresholds();
      toast("Thresholds reset to defaults");
    } catch (err) {
      toast(err?.message || "Failed to reset thresholds");
    }
  }, [loadWorkspaceThresholds, navigate, toast, wsId]);

  const mapMemberRow = useCallback((m) => {
    const email = String(m.email || "");
    const name = m.name || email.split("@")[0] || "Member";
    return {
      user_id: m.user_id || null,
      invite_id: m.invite_id || m.id || null,
      name,
      email,
      role: m.role,
      status: m.status || "active",
      color: "#6b7280",
      initials: name.slice(0, 2).toUpperCase()
    };
  }, []);

  const loadMembers = useCallback(async () => {
    if (!wsId) return;
    setMembersLoading(true);
    try {
      const data = await apiGet(`/api/workspaces/${wsId}/members`, { navigate });
      const active = (Array.isArray(data.members) ? data.members : []).map((m) =>
        mapMemberRow({ ...m, status: "active" })
      );
      const pending = (Array.isArray(data.invites) ? data.invites : []).map((i) =>
        mapMemberRow({ ...i, name: i.email.split("@")[0], status: "pending", invite_id: i.id })
      );
      setMembers([...active, ...pending]);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, [mapMemberRow, navigate, wsId]);

  useEffect(() => {
    if (section === "team") void loadMembers();
  }, [section, loadMembers]);

  const sendMemberInvite = useCallback(
    async (email, role) => {
      await apiPost(`/api/workspaces/${wsId}/members/invite`, { email, role }, { navigate });
      await loadMembers();
      toast(`Invite sent to ${email}`);
    },
    [loadMembers, navigate, toast, wsId]
  );

  const updateMemberRole = useCallback(
    async (userId, role, displayName) => {
      await apiPatch(`/api/workspaces/${wsId}/members/${userId}`, { role }, { navigate });
      await loadMembers();
      toast(`${displayName}'s role updated to ${ROLES[role] || role}`);
    },
    [loadMembers, navigate, toast, wsId]
  );

  const removeMember = useCallback(
    async (userId, displayName) => {
      await apiDelete(`/api/workspaces/${wsId}/members/${userId}`, { navigate });
      await loadMembers();
      toast(`${displayName} removed from workspace`);
    },
    [loadMembers, navigate, toast, wsId]
  );

  const revokeInvite = useCallback(
    async (inviteId, email) => {
      await apiDelete(`/api/workspaces/${wsId}/members/invites/${inviteId}`, { navigate });
      await loadMembers();
      toast(`Invite revoked for ${email}`);
    },
    [loadMembers, navigate, toast, wsId]
  );

  const governanceReadiness = useMemo(
    () => ({
      eval: isEvalSourceConnected(sources) || hasConnectedSignalSource(signalPanel),
      thresholds: isThresholdsConfiguredFromApi(workspaceThresholds),
      trigger: isReleaseTriggerReady(triggerConfig, githubAppStatus)
    }),
    [sources, signalPanel, workspaceThresholds, triggerConfig, githubAppStatus]
  );

  const loadGithubAppStatus = useCallback(async () => {
    try {
      const status = await apiGet(`/api/workspaces/${wsId}/github-app/status`, { navigate });
      setGithubAppStatus({
        configured: status?.configured === true,
        connected: status?.connected === true,
        installation: status?.installation || null,
        selected_repo_count: Number(status?.selected_repo_count || 0)
      });
    } catch (_) {
      setGithubAppStatus({
        configured: false,
        connected: false,
        installation: null,
        selected_repo_count: 0
      });
    }
  }, [navigate, wsId]);

  const loadGithubRepos = useCallback(async () => {
    setGithubReposLoading(true);
    try {
      const data = await apiGet(`/api/workspaces/${wsId}/github-app/repos`, { navigate });
      setGithubRepos(Array.isArray(data?.repos) ? data.repos : []);
    } catch (_) {
      setGithubRepos([]);
    } finally {
      setGithubReposLoading(false);
    }
  }, [navigate, wsId]);

  const loadVcsIntegration = useCallback(async () => {
    try {
      const data = await apiGet(`/api/workspaces/${wsId}/vcs-integration`, { navigate });
      setVcsCfg(data);
      setVcsForm((f) => ({ ...f, provider: data.provider || "github", owner: data.owner || "", repo: data.repo || "" }));
    } catch (_) {
      setVcsCfg(null);
    }
  }, [wsId, navigate]);

  useEffect(() => {
    loadGithubAppStatus();
    loadVcsIntegration();
  }, [loadGithubAppStatus, loadVcsIntegration]);

  useEffect(() => {
    let active = true;
    const loadGithubLabelTrigger = async () => {
      try {
        const cfg = await apiGet(`/api/workspaces/${wsId}/github-label-trigger`, { navigate });
        if (!active || !cfg) return;
        setTriggerConfig((prev) => {
          const next = { ...prev };
          if (typeof cfg.label_name === "string" && cfg.label_name.trim()) {
            next.label = cfg.label_name.trim();
          }
          if (cfg.enabled === true) {
            next.mode = "label";
          } else if (next.mode === "label") {
            delete next.mode;
          }
          return next;
        });
      } catch (_) {}
    };
    void loadGithubLabelTrigger();
    return () => {
      active = false;
    };
  }, [wsId, navigate]);

  useEffect(() => {
    if (!githubAppStatus.connected) return;
    void loadGithubRepos();
  }, [githubAppStatus.connected, loadGithubRepos]);

  useEffect(() => {
    const visible = TRIGGER_MODES.filter((m) => MVP_TRIGGER_MODE_IDS.includes(m.id));
    setTriggerConfig((c) => {
      const { env: _env, mode, ...rest } = c;
      if (mode && visible.some((m) => m.id === mode)) return { ...rest, mode };
      return { ...rest };
    });
  }, []);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [section]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextSection = params.get("section");
    if (nextSection === "thresholds") {
      navigate("/thresholds", { replace: true });
      return;
    }
    if (nextSection && SECTION_LABELS[nextSection]) {
      setSection(nextSection);
    }
    const githubState = params.get("github");
    if (githubState === "connected") {
      toast("GitHub App connected. Select repositories and save trigger settings.");
      params.delete("github");
      const nextSearch = params.toString();
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });
    }
  }, [location.search, location.pathname, navigate, toast]);

  useEffect(() => {
    localStorage.setItem("vdk3_role_policy", JSON.stringify(rolePolicy));
  }, [rolePolicy]);

  const saveGeneral = () => {
    const cleanedSlug = slugifyWorkspaceSlug(generalSlug) || "workspace";
    localStorage.setItem("vdk3_workspace_slug", cleanedSlug);
    setGeneralSlug(cleanedSlug);
    if (import.meta.env.DEV) {
      const origin = normalizeApiBaseOrigin(apiBaseInput);
      if (origin) {
        localStorage.setItem("vdk3_api_base", origin);
        setApiBaseInput(origin);
      } else {
        localStorage.removeItem("vdk3_api_base");
        setApiBaseInput("");
      }
    }
    setGeneralNote("Saved");
    setGeneralDirty(false);
    toast("Changes saved");
    setTimeout(() => setGeneralNote("No unsaved changes"), 2000);
  };

  const saveTrigger = async () => {
    localStorage.setItem("vdk3_trigger", JSON.stringify(triggerConfig));
    try {
      if (triggerConfig.mode === "label") {
        await apiPut(
          `/api/workspaces/${wsId}/github-label-trigger`,
          {
            label_name: triggerConfig.label || DEFAULT_TRIGGER_CONFIG.label,
            enabled: true
          },
          { navigate }
        );
        if (githubAppStatus.connected) {
          const selected = githubRepos.filter((r) => r.selected === true);
          await apiPut(
            `/api/workspaces/${wsId}/github-app/repos`,
            {
              repos: selected.map((r) => ({
                repository_id: r.repository_id,
                owner: r.owner,
                repo: r.repo,
                full_name: r.full_name
              }))
            },
            { navigate }
          );
        }
      } else {
        await apiDelete(`/api/workspaces/${wsId}/github-label-trigger`, { navigate });
      }
      await loadGithubAppStatus();
      setTriggerDirty(false);
      toast("Trigger settings saved");
    } catch (err) {
      toast(err?.message || "Failed to save trigger settings");
    }
  };

  const beginGithubAppConnect = async () => {
    try {
      const out = await apiPost(`/api/workspaces/${wsId}/github-app/connect`, {}, { navigate });
      if (out?.install_url) {
        window.location.assign(out.install_url);
        return;
      }
      toast("Failed to start GitHub connect flow");
    } catch (err) {
      toast(err?.message || "Failed to start GitHub connect flow");
    }
  };

  const toggleGithubRepoSelected = (repositoryId, selected) => {
    setGithubRepos((prev) =>
      prev.map((r) => (Number(r.repository_id) === Number(repositoryId) ? { ...r, selected: !!selected } : r))
    );
    setTriggerDirty(true);
  };

  const saveVcsIntegration = async () => {
    setVcsSaving(true);
    try {
      await apiPut(`/api/workspaces/${wsId}/vcs-integration`, vcsForm, { navigate });
      await loadVcsIntegration();
      toast("VCS integration saved");
    } catch (err) {
      toast(err?.message || "Failed to save VCS integration");
    } finally {
      setVcsSaving(false);
    }
  };

  const removeVcsIntegration = async () => {
    try {
      await apiDelete(`/api/workspaces/${wsId}/vcs-integration`, { navigate });
      setVcsCfg(null);
      setVcsForm({ provider: "github", access_token: "", owner: "", repo: "" });
      toast("VCS integration removed");
    } catch (err) {
      toast(err?.message || "Failed to remove VCS integration");
    }
  };

  const logout = () => {
    localStorage.removeItem("vdk3_currentUser");
    navigate("/login", { replace: true });
  };

  return (
    <>
      <SettingsWorkspaceShell
        contentRef={contentRef}
        logout={logout}
        orgName={orgName}
        projectName={projectName}
        section={section}
        setSection={setSection}
        sidebarUser={sidebarUser}
        readiness={governanceReadiness}
      >
        <GeneralSettingsSection
          section={section}
          orgName={orgName}
          generalSlug={generalSlug}
          setGeneralSlug={setGeneralSlug}
          apiBaseInput={apiBaseInput}
          setApiBaseInput={setApiBaseInput}
          generalNote={generalNote}
          generalDirty={generalDirty}
          saveGeneral={saveGeneral}
          envChip={envChip}
          setEnvChip={setEnvChip}
          toast={toast}
          prodObservation={prodObservation}
          persistProdObservation={persistProdObservation}
          setGeneralDirty={setGeneralDirty}
          setGeneralNote={setGeneralNote}
          certVisibility={certVisibility}
          updateCertVisibility={updateCertVisibility}
        />
        <TeamSettingsSection
          section={section}
          members={members}
          membersLoading={membersLoading}
          currentUserEmail={sidebarUser.email}
          inviteEmail={inviteEmail}
          setInviteEmail={setInviteEmail}
          inviteRole={inviteRole}
          setInviteRole={setInviteRole}
          roleLabels={roleLabels}
          rolePolicy={rolePolicy}
          toast={toast}
          onSendInvite={sendMemberInvite}
          onUpdateRole={updateMemberRole}
          onRemoveMember={removeMember}
          onRevokeInvite={revokeInvite}
        />
        <ApiSignalSection
          section={section}
          wsId={wsId}
          navigate={navigate}
          toast={toast}
          signalPanel={signalPanel}
          signalPanelLoading={signalPanelLoading}
          signalPanelError={signalPanelError}
          setConnectModal={setConnectModal}
          csvInputRef={csvInputRef}
          loadSignalSources={loadSignalSources}
          setSection={setSection}
        />
        <AgentAccessSection section={section} wsId={wsId} navigate={navigate} toast={toast} />
        <TriggerSettingsSection
          section={section}
          wsId={wsId}
          triggerConfig={triggerConfig}
          setTriggerConfig={(updater) => { setTriggerConfig(updater); setTriggerDirty(true); }}
          saveTrigger={saveTrigger}
          triggerDirty={triggerDirty}
          githubAppStatus={githubAppStatus}
          githubRepos={githubRepos}
          githubReposLoading={githubReposLoading}
          beginGithubAppConnect={beginGithubAppConnect}
          toggleGithubRepoSelected={toggleGithubRepoSelected}
          refreshGithubRepos={loadGithubRepos}
          toast={toast}
          vcsCfg={vcsCfg}
          vcsForm={vcsForm}
          setVcsForm={setVcsForm}
          saveVcsIntegration={saveVcsIntegration}
          removeVcsIntegration={removeVcsIntegration}
          vcsSaving={vcsSaving}
        />
        <NotificationsSettingsSection
          section={section}
          toast={toast}
          slackWebhookInput={slackWebhookInput}
          setSlackWebhookInput={setSlackWebhookInput}
          saveSlackWebhook={saveSlackWebhook}
          slackSaving={slackSaving}
        />
        <GovernancePanel section={section} wsId={wsId} toast={toast} />
        <BillingSettingsSection section={section} />
        <DangerZoneSection
          section={section}
          toast={toast}
          resetThresholds={resetThresholdsToDefaults}
        />
        <EmailPreviewsSection section={section} />
      </SettingsWorkspaceShell>

      <ConnectSignalSourceModal
        open={!!connectModal}
        onClose={() => setConnectModal(null)}
        sourceId={connectModal?.sourceId || "braintrust"}
        name={connectModal?.name || ""}
        workspaceId={wsId}
        navigate={navigate}
        onSuccess={loadSignalSources}
        toast={toast}
      />

      <div className={`toast${toastShow ? " show" : ""}`} id="toast">
        {toastMsg ? (
          <>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 6l3 3 5-5" stroke="var(--green)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{toastMsg}</span>
          </>
        ) : null}
      </div>
    </>
  );
}
