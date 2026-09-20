import { useState, useEffect, type FormEvent } from "react";
type Row = Record<string, any>;
export default function Accounts({ employees }: { employees: Row[] }) {
  const [users, setUsers] = useState<Row[]>([]),
    [edit, setEdit] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const r = await fetch("/api/users");
    if (!r.ok) throw new Error("Se requiere una sesión de administrador.");
    setUsers(await r.json());
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const value = {
      ...Object.fromEntries(f),
      id: edit?.id,
      active: f.has("active"),
      employee_ids: f.getAll("employee_ids"),
      password: f.get("password") || undefined,
    };
    try {
      const r = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setEdit(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="info-line">
        Cada cuenta tiene permisos propios. Al guardar cambios se cierran todas
        las sesiones de ese usuario. La última cuenta administradora activa se
        conserva.
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel settings-panel">
        <div className="section-heading">
          <h2>Cuentas de acceso</h2>
          <button
            className="primary"
            onClick={() =>
              setEdit({ role: "hr", active: true, employee_ids: [] })
            }
          >
            Agregar usuario
          </button>
        </div>
        {edit && (
          <form onSubmit={submit}>
            <div className="form-grid">
              <label className="field">
                <span>Nombre</span>
                <input
                  name="name"
                  defaultValue={edit.name}
                  required
                  minLength={2}
                />
              </label>
              <label className="field">
                <span>Correo de acceso</span>
                <input
                  name="email"
                  type="email"
                  defaultValue={edit.email}
                  autoComplete="off"
                  required
                />
              </label>
              <label className="field">
                <span>
                  {edit.id ? "Nueva contraseña (opcional)" : "Contraseña"}
                </span>
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  maxLength={256}
                  required={!edit.id}
                  autoComplete="new-password"
                />
                <small>
                  Mínimo 12 caracteres. Compartila por un canal privado.
                </small>
              </label>
              <label className="field">
                <span>Permisos</span>
                <select
                  name="role"
                  value={edit.role}
                  onChange={(e) => setEdit({ ...edit, role: e.target.value })}
                >
                  <option value="admin">
                    Administrador · usuarios y operación
                  </option>
                  <option value="hr">RRHH · operación global</option>
                  <option value="supervisor">
                    Supervisor · empleados asignados
                  </option>
                </select>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={edit.active}
                />
                Cuenta activa
              </label>
              {edit.role === "supervisor" && (
                <fieldset>
                  <legend>Empleados a cargo</legend>
                  {employees.map((e) => (
                    <label className="checkbox" key={e.id}>
                      <input
                        type="checkbox"
                        name="employee_ids"
                        value={e.id}
                        defaultChecked={edit.employee_ids?.includes(e.id)}
                      />
                      {e.name}
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
            <div className="form-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => setEdit(null)}
              >
                Cancelar
              </button>
              <button className="primary" disabled={busy}>
                Guardar usuario
              </button>
            </div>
          </form>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Permisos</th>
                <th>Estado</th>
                <th>Alcance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                    <small className="account-email">{u.email}</small>
                  </td>
                  <td>
                    {
                      (
                        {
                          admin: "Administrador",
                          hr: "RRHH",
                          supervisor: "Supervisor",
                        } as Row
                      )[u.role]
                    }
                  </td>
                  <td>{u.active ? "Activo" : "Inactivo"}</td>
                  <td>
                    {u.role === "supervisor"
                      ? `${u.employee_ids.length} empleados`
                      : "Toda la organización"}
                  </td>
                  <td>
                    <button className="text-button" onClick={() => setEdit(u)}>
                      Editar acceso
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
