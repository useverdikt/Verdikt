import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  SECTION_LABELS,
  TRIGGER_MODES,
  MVP_TRIGGER_MODE_IDS,
  DEFAULT_TRIGGER_CONFIG
} from "./settingsData.js";
import {
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  getWorkspaceId,
  onApiUnauthorized
} from "./settingsClient.js";
import ConnectSignalSourceModal from "./ConnectSignalSourceModal.jsx";
import { getSafeApiBase } from "../../lib/apiBase.js";
import { normalizeStoredProject, primaryCertEnvFromTiers } from "../../lib/projectEnv.js";
import {
  cloneSourcesBase,
  mergeSourcesFromApi,
  loadRolePolicy,
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

  const [prodObservation, setProdObservation] = useState(() => {
    try {
      const raw = localStorage.getItem("vdk3_project");
      if (!raw) return false;
      return normalizeStoredProject(JSON.parse(raw)).prodObservation === true;
    } catch (_) {
      return false;
    }
  });

  const persistProdObservation = (next) => {
    setProdObservation(next);
    try {
      const raw = localStorage.getItem("vdk3_project");
      const parsed = raw ? JSON.parse(raw) : {};
      localStorage.setItem("vdk3_project", JSON.stringify({ ...parsed, prodObservation: next }));
    } catch (_) {
      /* ignore */
    }
    toast(next ? "Production observation on — post-deploy intelligence enabled" : "Production observation off");
  };

  const [members, setMembers] = useState(() => []);
  const [rolePolicy, _setRolePolicy] = useState(loadRolePolicy);

  const [sources, setSources] = useState(() => cloneSourcesBase());
  const [workspaceThresholds, setWorkspaceThresholds] = useState(null);
  const [expandedSource, setExpandedSource] = useState(null);
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
    try {
      const data = await apiGet(`/api/workspaces/${wsId}/signal-integrations`, { navigate });
      setSources(mergeSourcesFromApi(cloneSourcesBase(), data));
    } catch {
      /* keep local seed when logged out or API unavailable */
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

  const governanceReadiness = useMemo(
    () => ({
      eval: isEvalSourceConnected(sources),
      thresholds: isThresholdsConfiguredFromApi(workspaceThresholds),
      trigger: isReleaseTriggerReady(triggerConfig, githubAppStatus)
    }),
    [sources, workspaceThresholds, triggerConfig, githubAppStatus]
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
        />
        <TeamSettingsSection
          section={section}
          members={members}
          setMembers={setMembers}
          inviteEmail={inviteEmail}
          setInviteEmail={setInviteEmail}
          inviteRole={inviteRole}
          setInviteRole={setInviteRole}
          roleLabels={roleLabels}
          rolePolicy={rolePolicy}
          toast={toast}
        />
        <ApiSignalSection
          section={section}
          wsId={wsId}
          navigate={navigate}
          toast={toast}
          sources={sources}
          setSources={setSources}
          expandedSource={expandedSource}
          setExpandedSource={setExpandedSource}
          setConnectModal={setConnectModal}
          csvInputRef={csvInputRef}
          loadSignalSources={loadSignalSources}
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
        <NotificationsSettingsSection section={section} toast={toast} />
        <GovernancePanel section={section} wsId={wsId} toast={toast} />
        <BillingSettingsSection section={section} />
        <DangerZoneSection section={section} toast={toast} />
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
