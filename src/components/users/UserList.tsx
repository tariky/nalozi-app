import { useState, useEffect } from "react";
import { Plus, Trash2, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usersApi, mechanicsApi } from "@/lib/api";
import { formatDate } from "@/lib/formatters";
import type { AuthUser, Mechanic } from "@/types";

export function UserList() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  // Form state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<'admin' | 'mechanic'>('mechanic');
  const [mechanicId, setMechanicId] = useState<string>("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [usersResult, mechanicsResult] = await Promise.all([
      usersApi.getAll(),
      mechanicsApi.getAll(),
    ]);

    if (usersResult.success && usersResult.data) {
      setUsers(usersResult.data);
    }
    if (mechanicsResult.success && mechanicsResult.data) {
      setMechanics(mechanicsResult.data);
    }
    setLoading(false);
  };

  // Get mechanics that don't have a user account yet
  const availableMechanics = mechanics.filter(m =>
    m.aktivan && !users.some(u => u.mechanic_id === m.id)
  );

  const resetForm = () => {
    setUsername("");
    setPassword("");
    setRole("mechanic");
    setMechanicId("");
    setFormError("");
  };

  const handleCreate = async () => {
    setFormError("");

    if (!username.trim()) {
      setFormError("Korisničko ime je obavezno");
      return;
    }
    if (!password.trim() || password.length < 4) {
      setFormError("Lozinka mora imati najmanje 4 karaktera");
      return;
    }
    if (role === 'mechanic' && !mechanicId) {
      setFormError("Morate odabrati mehaničara");
      return;
    }

    setSaving(true);
    const result = await usersApi.create({
      username: username.trim(),
      password: password.trim(),
      role,
      mechanic_id: mechanicId ? parseInt(mechanicId) : undefined,
    });

    if (result.success) {
      setShowCreateDialog(false);
      resetForm();
      loadData();
    } else {
      setFormError(result.error || "Greška pri kreiranju korisnika");
    }
    setSaving(false);
  };

  const handleChangePassword = async () => {
    if (!selectedUserId) return;

    setFormError("");
    if (!password.trim() || password.length < 4) {
      setFormError("Lozinka mora imati najmanje 4 karaktera");
      return;
    }

    setSaving(true);
    const result = await usersApi.changePassword(selectedUserId, password.trim());

    if (result.success) {
      setShowPasswordDialog(false);
      setPassword("");
      setSelectedUserId(null);
    } else {
      setFormError(result.error || "Greška pri promjeni lozinke");
    }
    setSaving(false);
  };

  const handleDelete = async (userId: number) => {
    if (!confirm("Da li ste sigurni da želite obrisati ovog korisnika?")) return;

    const result = await usersApi.delete(userId);
    if (result.success) {
      loadData();
    }
  };

  const openPasswordDialog = (userId: number) => {
    setSelectedUserId(userId);
    setPassword("");
    setFormError("");
    setShowPasswordDialog(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Učitavanje...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Korisnici</h1>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          <span className="hidden sm:inline">Novi korisnik</span>
          <span className="sm:hidden">Novi</span>
        </Button>
      </div>

      {/* Users list */}
      <div className="bg-card rounded-none border border-border overflow-hidden">
        <div className="divide-y divide-border">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between p-4 hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{user.username}</span>
                  <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                    {user.role === 'admin' ? 'Administrator' : 'Mehaničar'}
                  </Badge>
                </div>
                {user.mechanic && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {user.mechanic.ime} {user.mechanic.prezime}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openPasswordDialog(user.id)}
                  title="Promijeni lozinku"
                >
                  <Key className="h-4 w-4" />
                </Button>
                {user.username !== 'admin' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(user.id)}
                    title="Obriši"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))}

          {users.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              Nema korisnika
            </div>
          )}
        </div>
      </div>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novi korisnik</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Korisničko ime</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Unesite korisničko ime"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Lozinka</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Unesite lozinku"
              />
            </div>

            <div className="space-y-2">
              <Label>Uloga</Label>
              <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'mechanic')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mechanic">Mehaničar</SelectItem>
                  <SelectItem value="admin">Administrator</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {role === 'mechanic' && (
              <div className="space-y-2">
                <Label>Mehaničar</Label>
                <Select value={mechanicId} onValueChange={setMechanicId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Odaberite mehaničara" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableMechanics.map((mechanic) => (
                      <SelectItem key={mechanic.id} value={String(mechanic.id)}>
                        {mechanic.ime} {mechanic.prezime}
                      </SelectItem>
                    ))}
                    {availableMechanics.length === 0 && (
                      <div className="text-sm text-muted-foreground p-2">
                        Nema dostupnih mehaničara (svi imaju račun)
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {formError && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-none border border-border">
                {formError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowCreateDialog(false);
              resetForm();
            }}>
              Odustani
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Kreiranje..." : "Kreiraj"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promjena lozinke</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">Nova lozinka</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Unesite novu lozinku"
              />
            </div>

            {formError && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-none border border-border">
                {formError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowPasswordDialog(false);
              setPassword("");
              setSelectedUserId(null);
            }}>
              Odustani
            </Button>
            <Button onClick={handleChangePassword} disabled={saving}>
              {saving ? "Spremanje..." : "Spremi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
