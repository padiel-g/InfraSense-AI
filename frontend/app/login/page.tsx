"use client";
import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { Loader2, Eye, EyeOff, ShieldCheck, HelpCircle } from "lucide-react";
import { extractApiError } from "@/lib/utils";
import bg from "@/images/image.png";

type Mode = "login" | "register";

export default function LoginPage() {
  const { login, register, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace("/dashboard");
  }, [isLoading, isAuthenticated, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return; // guard against double-submit race
    setError("");
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password, rememberMe);
      } else {
        await register({ email, password, full_name: fullName });
      }
      router.replace("/dashboard");
    } catch (err: unknown) {
      setError(
        extractApiError(
          err,
          mode === "login"
            ? "Invalid credentials. Please check your email and password."
            : "Registration failed. The email may already be in use."
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg,#7dd3ea 0%,#29afd4 40%,#0e8ab5 100%)" }}>
        <Loader2 className="h-10 w-10 animate-spin text-white" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen relative flex items-center justify-center p-4"
      style={{
        backgroundImage: `url('${bg.src}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      {/* Dark overlay */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(180deg,rgba(0,0,0,0.35) 0%,rgba(0,0,0,0.65) 100%)" }}
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center text-white mb-6">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md flex items-center justify-center mb-3">
            <svg width="42" height="42" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M32 6l22 10v16c0 14-9.6 26.7-22 30C19.6 58.7 10 46 10 32V16L32 6z" stroke="white" strokeWidth="3" fill="rgba(255,255,255,0.08)"/>
              <path d="M24 34c3-7 5-12 8-18 3 6 5 11 8 18" stroke="white" strokeWidth="3" strokeLinecap="round"/>
              <path d="M22 36h20" stroke="white" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="text-4xl font-extrabold tracking-wide">IMADS</h1>
          <p className="text-sm text-white/80 mt-1">Integrated Municipal</p>
          <p className="text-sm text-white/80">Anomaly Detection System</p>
        </div>

        <div
          className="rounded-2xl shadow-2xl p-7 border"
          style={{ background: "rgba(10,14,20,0.62)", backdropFilter: "blur(18px)", borderColor: "rgba(255,255,255,0.16)" }}
        >
          <div className="flex rounded-xl border border-white/15 bg-white/5 p-1 mb-6 gap-1">
            {(["login", "register"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(""); }}
                className={
                  "flex-1 py-2 rounded-lg text-sm font-semibold transition-all "
                  + (mode === m
                    ? "bg-blue-600 text-white shadow"
                    : "text-white/70 hover:text-white")
                }
              >
                {m === "login" ? "Login" : "Sign Up"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label className="block text-sm font-semibold text-white/85 mb-1">Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Padiel Gerald"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="w-full rounded-xl border border-white/15 bg-white/5 text-white placeholder:text-white/40 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-white/85 mb-1">Email</label>
              <input
                type="email"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full rounded-xl border border-white/15 bg-white/5 text-white placeholder:text-white/40 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-white/85 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className="w-full rounded-xl border border-white/15 bg-white/5 text-white placeholder:text-white/40 px-3 py-2.5 pr-10 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
                  onClick={() => setShowPw(!showPw)}
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {mode === "login" && (
                <div className="flex items-center justify-between mt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="accent-blue-600 h-3.5 w-3.5"
                    />
                    <span className="text-xs text-white/75">Remember me</span>
                  </label>
                  <a href="#" className="text-xs text-blue-300 hover:underline">
                    Forgot your password?
                  </a>
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/25 px-3 py-2.5">
                <p className="text-sm text-red-200">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl text-white font-bold text-sm shadow-md hover:opacity-95 active:scale-[.98] transition-all disabled:opacity-60 mt-1 bg-blue-600 hover:bg-blue-500"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Please wait...
                </span>
              ) : mode === "login" ? "Login" : "Sign Up"}
            </button>
          </form>

          <div className="mt-5 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
              className="text-sm font-semibold text-white/80 hover:text-white"
            >
              {mode === "login" ? "Sign Up" : "Already have an account? Login"}
            </button>
            <a href="/resident" className="flex items-center gap-1 text-xs text-white/65 hover:text-white">
              <HelpCircle className="h-3.5 w-3.5" />
              Resident Click Here
            </a>
          </div>

          <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-center gap-2 text-[11px] text-white/55">
            <ShieldCheck className="h-3.5 w-3.5" />
            Gweru City Council {" — "} Secured Municipal Platform
          </div>
        </div>

        <div className="text-center text-white/70 text-xs mt-6">
          © {new Date().getFullYear()} IMADS. All rights reserved.
        </div>
      </div>
    </div>
  );
}
