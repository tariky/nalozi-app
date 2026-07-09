import { useState } from "react";
import { LogIn, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import logoSrc from "@/logo.svg";

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await login(username, password);

    if (!result.success) {
      setError(result.error || "Greška pri prijavi");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-foreground relative overflow-hidden">
        {/* Geometric Pattern */}
        <div className="absolute inset-0 opacity-[0.03]">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        {/* Diagonal Lines */}
        <div className="absolute inset-0 opacity-[0.02]">
          <div className="absolute top-0 left-0 w-full h-full"
            style={{
              backgroundImage: `repeating-linear-gradient(
                45deg,
                transparent,
                transparent 100px,
                rgba(255,255,255,0.5) 100px,
                rgba(255,255,255,0.5) 101px
              )`
            }}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          {/* Logo */}
          <div>
            <img
              src={logoSrc}
              alt="AutoNalog"
              className="h-14 w-auto invert opacity-90"
            />
          </div>

          {/* Tagline */}
          <div className="space-y-6">
            <h1 className="text-5xl font-bold text-background leading-tight tracking-tight">
              Upravljajte<br />
              servisom<br />
              <span className="text-background/60">efikasnije.</span>
            </h1>
            <p className="text-background/50 text-lg max-w-md">
              Kompletan sistem za praćenje radnih naloga, klijenata i analitiku vašeg auto servisa.
            </p>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-8 text-background/30 text-sm">
            <span>© 2026 AutoNalog</span>
            <span>•</span>
            <span>v1.0.0</span>
          </div>
        </div>

        {/* Large decorative number */}
        <div className="absolute -right-20 -bottom-20 text-[400px] font-bold text-background/[0.02] leading-none select-none">
          24
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden mb-12 text-center">
            <img
              src={logoSrc}
              alt="AutoNalog"
              className="h-12 w-auto mx-auto mb-4"
            />
            <p className="text-muted-foreground text-sm">
              Auto Servis Management
            </p>
          </div>

          {/* Welcome Text */}
          <div className="mb-10">
            <h2 className="text-3xl font-bold text-foreground tracking-tight">
              Dobrodošli
            </h2>
            <p className="text-muted-foreground mt-2">
              Prijavite se na vaš račun za nastavak
            </p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label
                htmlFor="username"
                className={`text-sm font-medium transition-colors duration-200 ${
                  focused === 'username' ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                Korisničko ime
              </Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setFocused('username')}
                onBlur={() => setFocused(null)}
                placeholder="Unesite korisničko ime"
                required
                autoFocus
                className="h-12 px-4 text-base"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="password"
                className={`text-sm font-medium transition-colors duration-200 ${
                  focused === 'password' ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                Lozinka
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                placeholder="Unesite lozinku"
                required
                className="h-12 px-4 text-base"
              />
            </div>

            {error && (
              <div className="flex items-center gap-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 p-4">
                <div className="w-2 h-2 bg-destructive rounded-full shrink-0" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-12 text-base font-medium group"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Prijava u toku...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Prijavi se
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                </span>
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="mt-10 pt-10 border-t border-border">
            <p className="text-center text-sm text-muted-foreground">
              Problemi s prijavom?{" "}
              <span className="text-foreground font-medium cursor-pointer hover:underline">
                Kontaktirajte administratora
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
