import "server-only";
import { Section } from "../Section";
import { PoolRow } from "./PoolRow";
import { AddForm } from "./AddForm";
import { snapshot } from "@/lib/site/snapshot";
import { storedPool, mergedPool } from "@/lib/pools/read";
import { lastTest } from "@/lib/pools/test";
import { activeIndex } from "@/lib/pools/rotate";
import { activeProxyIndex } from "@/lib/server/http";
import { activeRelayIndex } from "@/lib/server/relay";
import type { PoolKind } from "@/lib/pools/types";

function activeEnabledPosition(kind: PoolKind, enabledCount: number): number {
  if (kind === "proxies") return activeProxyIndex();
  if (kind === "relays") return activeRelayIndex();
  return activeIndex(kind, enabledCount);
}

/** Ordered list UI for a pool: rows + add form + "test all". Failover order = list order. */
export function PoolManager({ kind, base, title, desc }: { kind: PoolKind; base: string; title: string; desc: string }) {
  const stored = storedPool(snapshot().secrets, kind);
  const list = mergedPool(snapshot().secrets, kind);
  const action = `${base}/api/pool?kind=${kind}`;
  const enabled = list.filter((e) => e.enabled);
  const activeId = enabled[activeEnabledPosition(kind, enabled.length)]?.id;
  return (
    <Section title={title} desc={desc}>
      {!stored && list.length > 0 && (
        <p className="rounded-xl border border-line bg-surface/40 p-2 text-xs text-ink-3">
          هذي القائمة جاية من إعدادات Render الحالية. أول تعديل تسويه هنا ينسخها للوحة وتصير اللوحة هي المرجع.
        </p>
      )}
      {list.length === 0 ? (
        <p className="text-sm text-ink-3">ما فيه شي مضاف للحين.</p>
      ) : (
        <ol className="space-y-2">
          {list.map((e, i) => (
            <PoolRow key={e.id} kind={kind} e={e} i={i} n={list.length} action={action} active={e.id === activeId} test={lastTest(kind, e.id)} />
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <AddForm kind={kind} action={action} />
        </div>
        {list.length > 0 && (
          <form method="post" action={action}>
            <input type="hidden" name="op" value="testall" />
            <button className="btn-ghost">🧪 اختبار الكل</button>
          </form>
        )}
      </div>
    </Section>
  );
}
