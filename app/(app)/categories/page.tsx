"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Category } from "@/types/database";
import { buildTree, getDescendantIds, type CategoryNode } from "@/lib/categories";
import CategorySelect from "@/components/CategorySelect";
import Link from "next/link";
import { IconArrowLeft } from "@/components/ui/Icons";

export default function CategoriesPage() {
  const supabase = createClient();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // formulario de creación
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // edición inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editParent, setEditParent] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("categories").select("*").order("name");
    if (error) setError(error.message);
    setCategories(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("categories")
      .insert({ name: name.trim(), parent_id: parentId, user_id: user!.id });
    setSaving(false);
    if (error) return setError(error.message);
    setName("");
    load();
  }

  function startEdit(c: Category) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditParent(c.parent_id);
  }

  async function saveEdit() {
    if (!editingId || !editName.trim()) return;
    const { error } = await supabase
      .from("categories")
      .update({ name: editName.trim(), parent_id: editParent })
      .eq("id", editingId);
    if (error) return setError(error.message);
    setEditingId(null);
    load();
  }

  async function remove(c: Category) {
    const descendants = getDescendantIds(categories, c.id).length - 1;
    const msg =
      `¿Eliminar "${c.name}"` +
      (descendants > 0 ? ` y sus ${descendants} subcategoría(s)` : "") +
      `? Sus productos quedarán sin categoría.`;
    if (!confirm(msg)) return;
    const { error } = await supabase.from("categories").delete().eq("id", c.id);
    if (error) return setError(error.message);
    load();
  }

  const tree = buildTree(categories);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="animate-in">
        <Link href="/store" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><IconArrowLeft size={16} /> Mi tienda</Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Subcategorías (avanzado)</h1>
        <p className="text-sm text-slate-500">Árbol completo de categorías y subcategorías. Para lo habitual usa <Link href="/store" className="underline">Mi tienda</Link>.</p>
      </div>

      <form onSubmit={create} className="animate-in card grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label className="label" htmlFor="name">Nombre</label>
          <input id="name" className="input" placeholder="Ej. Bebidas" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="parent">Dentro de (opcional)</label>
          <CategorySelect id="parent" categories={categories} value={parentId} onChange={setParentId} emptyLabel="— Categoría principal —" />
        </div>
        <div className="flex items-end">
          <button className="btn-primary w-full" disabled={saving}>{saving ? "Guardando..." : "Agregar"}</button>
        </div>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="animate-in card p-0">
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Cargando...</p>
        ) : tree.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Aún no tienes subcategorías. Crea la primera aquí, o deja que la IA las proponga al tomar fotos.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tree.map((n) => (
              <TreeItem
                key={n.id}
                node={n}
                categories={categories}
                editingId={editingId}
                editName={editName}
                editParent={editParent}
                setEditName={setEditName}
                setEditParent={setEditParent}
                onStartEdit={startEdit}
                onSaveEdit={saveEdit}
                onCancelEdit={() => setEditingId(null)}
                onRemove={remove}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface ItemProps {
  node: CategoryNode;
  categories: Category[];
  editingId: string | null;
  editName: string;
  editParent: string | null;
  setEditName: (v: string) => void;
  setEditParent: (v: string | null) => void;
  onStartEdit: (c: Category) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRemove: (c: Category) => void;
}

function TreeItem(props: ItemProps) {
  const { node, categories, editingId } = props;
  const isEditing = editingId === node.id;
  return (
    <>
      <li className="flex flex-wrap items-center gap-2 px-4 py-2.5" style={{ paddingLeft: `${16 + node.depth * 20}px` }}>
        {isEditing ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <input className="input sm:max-w-xs" value={props.editName} onChange={(e) => props.setEditName(e.target.value)} autoFocus />
            <CategorySelect
              categories={categories}
              value={props.editParent}
              onChange={props.setEditParent}
              emptyLabel="— Categoría principal —"
              excludeIds={getDescendantIds(categories, node.id)}
              className="input sm:max-w-xs"
            />
            <div className="flex gap-2">
              <button className="btn-primary px-3 py-1.5" onClick={props.onSaveEdit}>Guardar</button>
              <button className="btn-secondary px-3 py-1.5" onClick={props.onCancelEdit}>Cancelar</button>
            </div>
          </div>
        ) : (
          <>
            <span className="text-slate-400">{node.depth > 0 ? "└" : "•"}</span>
            <span className="flex-1 text-sm font-medium">{node.name}</span>
            {node.children.length > 0 && (
              <span className="badge bg-slate-100 text-slate-600">{node.children.length} sub</span>
            )}
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => props.onStartEdit(node)}>Editar</button>
            <button className="btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => props.onRemove(node)}>Eliminar</button>
          </>
        )}
      </li>
      {node.children.map((child) => (
        <TreeItem key={child.id} {...props} node={child} />
      ))}
    </>
  );
}
