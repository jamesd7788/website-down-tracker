"use client";

import { useState, useEffect, type FormEvent } from "react";
import Link from "next/link";

export default function SettingsPage() {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [savedWebhookUrl, setSavedWebhookUrl] = useState("");
  const [webhookLoading, setWebhookLoading] = useState(true);
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookMsg, setWebhookMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const [testingSending, setTestSending] = useState(false);
  const [testMsg, setTestMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwChanging, setPwChanging] = useState(false);
  const [pwMsg, setPwMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        const url = data.slack_webhook_url || "";
        setWebhookUrl(url);
        setSavedWebhookUrl(url);
      })
      .catch(() => {})
      .finally(() => setWebhookLoading(false));
  }, []);

  async function handleWebhookSave(e: FormEvent) {
    e.preventDefault();
    setWebhookSaving(true);
    setWebhookMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slack_webhook_url: webhookUrl }),
      });
      if (!res.ok) {
        const data = await res.json();
        setWebhookMsg({ type: "err", text: data.error || "failed to save" });
        return;
      }
      setSavedWebhookUrl(webhookUrl);
      setWebhookMsg({ type: "ok", text: "saved" });
    } catch {
      setWebhookMsg({ type: "err", text: "network error" });
    } finally {
      setWebhookSaving(false);
    }
  }

  async function handleTestSlack() {
    setTestSending(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/settings/test-slack", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setTestMsg({ type: "err", text: data.error || "test failed" });
        return;
      }
      setTestMsg({ type: "ok", text: "test notification sent" });
    } catch {
      setTestMsg({ type: "err", text: "network error" });
    } finally {
      setTestSending(false);
    }
  }

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);

    if (newPassword !== confirmPassword) {
      setPwMsg({ type: "err", text: "passwords do not match" });
      return;
    }

    setPwChanging(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        setPwMsg({ type: "err", text: data.error || "failed to change password" });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwMsg({ type: "ok", text: "password changed" });
    } catch {
      setPwMsg({ type: "err", text: "network error" });
    } finally {
      setPwChanging(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:ring-zinc-400";

  const btnPrimary =
    "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

  const btnSecondary =
    "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800";

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              &larr; Dashboard
            </Link>
            <span className="text-zinc-300 dark:text-zinc-700">/</span>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Settings
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        {/* slack webhook */}
        <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Slack Notifications
            </h2>
          </div>
          <div className="p-4 space-y-4">
            <form onSubmit={handleWebhookSave} className="space-y-3">
              <div>
                <label
                  htmlFor="webhook-url"
                  className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Webhook URL
                </label>
                {webhookLoading ? (
                  <div className="h-9 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
                ) : (
                  <input
                    id="webhook-url"
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => {
                      setWebhookUrl(e.target.value);
                      setWebhookMsg(null);
                    }}
                    className={inputClass}
                    placeholder="https://hooks.slack.com/services/..."
                  />
                )}
              </div>
              <div className="flex items-center gap-3">
                <button type="submit" disabled={webhookSaving} className={btnPrimary}>
                  {webhookSaving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleTestSlack}
                  disabled={testingSending || !savedWebhookUrl}
                  className={btnSecondary}
                >
                  {testingSending ? "Sending..." : "Test"}
                </button>
              </div>
            </form>
            {webhookMsg && (
              <p
                className={`text-sm ${
                  webhookMsg.type === "ok"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {webhookMsg.text}
              </p>
            )}
            {testMsg && (
              <p
                className={`text-sm ${
                  testMsg.type === "ok"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {testMsg.text}
              </p>
            )}
          </div>
        </section>

        {/* check interval */}
        <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Monitoring
            </h2>
          </div>
          <div className="p-4">
            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Check Interval
              </p>
              <p className="mt-1 text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
                60 seconds
              </p>
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                configured at the server level and cannot be changed from the dashboard
              </p>
            </div>
          </div>
        </section>

        {/* change password */}
        <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Change Password
            </h2>
          </div>
          <div className="p-4">
            <form onSubmit={handlePasswordChange} className="max-w-sm space-y-3">
              <div>
                <label
                  htmlFor="current-password"
                  className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Current Password
                </label>
                <input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    setPwMsg(null);
                  }}
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label
                  htmlFor="new-password"
                  className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  New Password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setPwMsg(null);
                  }}
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label
                  htmlFor="confirm-password"
                  className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Confirm New Password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setPwMsg(null);
                  }}
                  required
                  className={inputClass}
                />
              </div>
              {pwMsg && (
                <p
                  className={`text-sm ${
                    pwMsg.type === "ok"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {pwMsg.text}
                </p>
              )}
              <button type="submit" disabled={pwChanging} className={btnPrimary}>
                {pwChanging ? "Changing..." : "Change Password"}
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}
