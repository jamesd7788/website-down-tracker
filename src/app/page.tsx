"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import Link from "next/link";

interface Check {
  id: number;
  siteId: number;
  statusCode: number | null;
  responseTimeMs: number | null;
  isUp: boolean | null;
  errorMessage: string | null;
  checkedAt: string;
}

interface Site {
  id: number;
  url: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  latestCheck: Check | null;
  activeAnomalyCount: number;
}

type Modal =
  | { type: "add" }
  | { type: "edit"; site: Site }
  | { type: "delete"; site: Site }
  | null;

export default function Dashboard() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("failed to fetch");
      const data = await res.json();
      setSites(data);
      setError("");
    } catch {
      setError("failed to load sites");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSites();
    const interval = setInterval(fetchSites, 30_000);
    return () => clearInterval(interval);
  }, [fetchSites]);

  function openAdd() {
    setFormName("");
    setFormUrl("");
    setFormError("");
    setModal({ type: "add" });
  }

  function openEdit(site: Site) {
    setFormName(site.name);
    setFormUrl(site.url);
    setFormError("");
    setModal({ type: "edit", site });
  }

  async function handleAddSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName, url: formUrl }),
      });
      if (!res.ok) {
        const data = await res.json();
        setFormError(data.error || "failed to add site");
        return;
      }
      setModal(null);
      await fetchSites();
    } catch {
      setFormError("network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (modal?.type !== "edit") return;
    setFormError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sites/${modal.site.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName, url: formUrl }),
      });
      if (!res.ok) {
        const data = await res.json();
        setFormError(data.error || "failed to update site");
        return;
      }
      setModal(null);
      await fetchSites();
    } catch {
      setFormError("network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (modal?.type !== "delete") return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sites/${modal.site.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setFormError("failed to delete site");
        return;
      }
      setModal(null);
      await fetchSites();
    } catch {
      setFormError("network error");
    } finally {
      setSubmitting(false);
    }
  }

  function formatTime(dateStr: string | null | undefined) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleString();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Site Monitor
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={openAdd}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              + Add Site
            </button>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Logout
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {sites.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              no sites monitored yet.{" "}
              <button
                onClick={openAdd}
                className="font-medium text-zinc-900 underline dark:text-zinc-100"
              >
                add one
              </button>
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">URL</th>
                  <th className="px-4 py-3">Response</th>
                  <th className="px-4 py-3">Last Checked</th>
                  <th className="px-4 py-3">Anomalies</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => {
                  const isUp = site.latestCheck?.isUp;
                  const hasAnomalies = site.activeAnomalyCount > 0;

                  return (
                    <tr
                      key={site.id}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50"
                    >
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full ${
                            isUp === true
                              ? "bg-emerald-500"
                              : isUp === false
                                ? "bg-red-500"
                                : "bg-zinc-300 dark:bg-zinc-600"
                          }`}
                          title={
                            isUp === true
                              ? "up"
                              : isUp === false
                                ? "down"
                                : "unknown"
                          }
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                        <Link
                          href={`/site/${site.id}`}
                          className="hover:underline"
                        >
                          {site.name}
                        </Link>
                        {!site.isActive && (
                          <span className="ml-2 text-xs text-zinc-400">
                            (paused)
                          </span>
                        )}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-zinc-500 dark:text-zinc-400">
                        {site.url}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-zinc-600 dark:text-zinc-300">
                        {site.latestCheck?.responseTimeMs != null
                          ? `${site.latestCheck.responseTimeMs}ms`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                        {formatTime(site.latestCheck?.checkedAt)}
                      </td>
                      <td className="px-4 py-3">
                        {hasAnomalies ? (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                            {site.activeAnomalyCount}
                          </span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openEdit(site)}
                          className="mr-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            setFormError("");
                            setModal({ type: "delete", site });
                          }}
                          className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* modal overlay */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {modal.type === "delete" ? (
              <>
                <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Delete Site
                </h2>
                <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
                  delete{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {modal.site.name}
                  </span>
                  ? this removes all check history and anomaly data.
                </p>
                {formError && (
                  <p className="mb-4 text-sm text-red-600 dark:text-red-400">
                    {formError}
                  </p>
                )}
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setModal(null)}
                    disabled={submitting}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={submitting}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {submitting ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {modal.type === "add" ? "Add Site" : "Edit Site"}
                </h2>
                <form
                  onSubmit={
                    modal.type === "add" ? handleAddSubmit : handleEditSubmit
                  }
                  className="flex flex-col gap-4"
                >
                  <div>
                    <label
                      htmlFor="site-name"
                      className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      Name
                    </label>
                    <input
                      id="site-name"
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      required
                      autoFocus
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
                      placeholder="My Website"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="site-url"
                      className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      URL
                    </label>
                    <input
                      id="site-url"
                      type="url"
                      value={formUrl}
                      onChange={(e) => setFormUrl(e.target.value)}
                      required
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
                      placeholder="https://example.com"
                    />
                  </div>
                  {formError && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {formError}
                    </p>
                  )}
                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setModal(null)}
                      disabled={submitting}
                      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                      {submitting
                        ? "Saving..."
                        : modal.type === "add"
                          ? "Add Site"
                          : "Save Changes"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
