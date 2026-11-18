// Dashboard tab: agent dials (the hero), token usage, projects.
import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, useSpring } from "motion/react";
import { Dial, paceOf } from "./Dial.jsx";
import { DaysChart, ProjectsChart } from "./Charts.jsx";
import { AnimatedNumber, RefreshIcon, Segmented, State, fmt, run, vscode } from "./ui.jsx";

// The one memorable motion: the dial card leans toward the pointer and a light in the agent's colour follows it.
function TiltCard({ agent, index, children }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const rx = useSpring(0, { stiffness: 160, damping: 18 });
  const ry = useSpring(0, { stiffness: 160, damping: 18 });
  const move = (e) => {
    const b = ref.current.getBoundingClientRect(), px = (e.clientX - b.left) / b.width, py = (e.clientY - b.top) / b.height;
    ref.current.style.setProperty("--mx", `${px * 100}%`);
    ref.current.style.setProperty("--my", `${py * 100}%`);
    if (reduce) return;
    ry.set((px - 0.5) * 5);
    rx.set((0.5 - py) * 5);
  };
  return (
    <motion.div
      ref={ref} className="dial-card" onPointerMove={move} onPointerLeave={() => { rx.set(0); ry.set(0); }}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 1000, "--agent": `var(--${agent})` }}
      initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay: index * 0.12, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="sheen" />
      {children}
    </motion.div>
  );
}

function AgentCard({ a, index }) {
  return (
    <TiltCard agent={a.agent} index={index}>
      <div className="dial-name"><b>{a.name}</b>{a.plan && <span>{a.plan}</span>}</div>
      <div className="dial-row">
        <div className="dial"><Dial agent={a.agent} windows={a.windows} delay={0.25 + index * 0.15} /></div>
        <div className="facts">
          {a.windows.length ? a.windows.map((w) => {
            const pace = paceOf(w);
            return (
              <div className="fact" key={w.label}>
                <div className="label">{w.label}</div>
                <div className="value"><AnimatedNumber value={w.pct} suffix="%" /></div>
                <div className="reset">{w.resetLong}</div>
                {pace && <div className={`pace pace-${pace.tone}`}><i />{pace.label}: {pace.share}</div>}
                <State sev={w.noteSev || w.sev}>{w.note}</State>
              </div>
            );
          }) : <State sev="unknown">{a.hint}</State>}
        </div>
      </div>
      {a.stale && <div className="stale">Обновлено {a.observed}. {a.hint.replace("Данные старше 30 минут. ", "")}</div>}
    </TiltCard>
  );
}

const agentName = (a) => (a === "claude" ? "Claude" : "Codex");

// One clickable chat line: takes you into that chat in Claude Code or Codex.
function ChatRow({ c, sub, latest, state }) {
  return (
    <li className={latest ? "latest" : ""}>
      <button type="button" className="chat-open" disabled={!c.id} onClick={() => run("tokens.openChat", [c.agent, c.id])} title={c.id ? "Перейти в чат" : "Чат ещё не записал сессию"}>
        <i className="dot" style={{ background: `var(--${c.agent})` }} />
        <span className="chat-title">{c.title}<small>{sub}</small></span>
        <span className="chat-state">{state}<span className="go">Перейти</span></span>
      </button>
    </li>
  );
}

const liveState = (c) => (c.working ? <span className="chat-live"><b className="pulse" />работает сейчас</span> : null);

// Open Claude Code / Codex chats; the section exists only while some are open.
function Chats({ chats }) {
  if (!chats || !chats.length) return null;
  const working = chats.filter((c) => c.working).length;
  return (
    <section className="chats">
      <div className="section-head">
        <div>
          <h2>Открытые чаты</h2>
          <div className="sub">{`Открыто: ${chats.length}. ${working ? `Работают сейчас: ${working}.` : "Сейчас ни один не работает."} Нажмите на чат, чтобы перейти в него.`}</div>
        </div>
        <button className="danger-btn" type="button" onClick={() => run("tokens.stopAllChats")}>Остановить все чаты</button>
      </div>
      <ul className="chat-list">
        {chats.map((c) => (
          <ChatRow
            key={c.pid} c={c}
            sub={`${c.agent === "claude" ? "Claude" : `Codex${c.threads > 1 ? `, чатов: ${c.threads}` : ""}`}${c.project ? `, ${c.project}` : ""}, открыт ${c.started}`}
            state={liveState(c) || <span>{c.last ? `ждёт, активность ${c.last}` : "ждёт"}</span>}
          />
        ))}
      </ul>
    </section>
  );
}

// All chats of a project, newest first; the newest is highlighted as the one to continue.
function ProjectChats({ chats, statusFile }) {
  return (
    <div className="project-chats">
      {chats.length ? (
        <ul className="chat-list nested">
          {chats.map((c, i) => (
            <ChatRow
              key={c.id} c={c} latest={i === 0}
              sub={`${agentName(c.agent)}, ${c.last}${i === 0 ? ", последний" : ""}`}
              state={liveState(c) || (c.open ? <span>открыт</span> : null)}
            />
          ))}
        </ul>
      ) : <div className="muted chat-empty">В этом проекте чатов пока нет. Откройте папку проекта в VS Code и начните чат там.</div>}
      {statusFile && <button className="link" type="button" onClick={() => run("tokens.openStatus", [statusFile])}>Открыть STATUS.md</button>}
    </div>
  );
}

function ProjectsTable({ projects, outsideChats, byProject, period }) {
  const [openRow, setOpenRow] = useState(null);
  const rows = [...projects, { name: "Вне проектов", folder: "сессии из общей папки PROJECTS", dir: "__outside", outside: true, chats: outsideChats || [] }];
  return (
    <table className="projects">
      <thead><tr><th>Проект</th><th>Стадия</th><th>Сейчас</th><th>Агент</th><th>Последний коммит</th><th className="r">{period === 1 ? "Токены сегодня" : `Токены за ${period} д`}</th><th className="r">Чаты</th></tr></thead>
      <tbody>
        {rows.map((p) => {
          const u = byProject[p.name], open = openRow === p.dir;
          const toggle = () => setOpenRow(open ? null : p.dir);
          return [
            <tr key={p.dir} className={`project-row${open ? " is-open" : ""}`} onClick={toggle}>
              <td><button className="pname" type="button" aria-expanded={open} onClick={(e) => { e.stopPropagation(); toggle(); }}>{p.name}<small>{p.folder}</small></button></td>
              <td>{p.outside ? <span className="muted">—</span> : p.hasStatus
                ? <span className="stage"><span className="steps">{[0, 1, 2, 3].map((i) => <i key={i} className={i < p.stageIndex ? "on" : ""} />)}</span>{p.stage || "—"}</span>
                : <State sev="warning">нет STATUS.md</State>}</td>
              <td>{p.outside ? <span className="muted">—</span> : p.hasStatus ? p.now || <span className="muted">—</span> : <button className="link" type="button" onClick={(e) => { e.stopPropagation(); run("tokens.createStatus", [p.dir]); }}>Создать по шаблону</button>}</td>
              <td>{p.agent ? <span className="who"><i className="dot" style={{ background: `var(--${p.agent})` }} />{agentName(p.agent)}</span> : <span className="muted">—</span>}</td>
              <td>{p.git ? <><code>{p.git.hash}</code> {p.git.date} <span className="muted">{p.git.dirty ? `${p.git.dirty} изм.` : "чисто"}</span></> : <span className="muted">{p.outside ? "—" : "нет git"}</span>}</td>
              <td className="r">{u ? fmt(u.claude + u.codex) : <span className="muted">—</span>}</td>
              <td className="r"><span className="chat-count">{p.chats.length || "—"}<motion.svg viewBox="0 0 16 16" animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }}><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></motion.svg></span></td>
            </tr>,
            <AnimatePresence key={`${p.dir}-chats`} initial={false}>
              {open && (
                <tr className="expand">
                  <td colSpan={7}>
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }} style={{ overflow: "hidden" }}>
                      <ProjectChats chats={p.chats} statusFile={p.statusFile} />
                    </motion.div>
                  </td>
                </tr>
              )}
            </AnimatePresence>,
          ];
        })}
      </tbody>
    </table>
  );
}

export function Dashboard({ data }) {
  const [period, setPeriod] = useState((vscode.getState() || {}).days || 7);
  const choose = (d) => { setPeriod(d); vscode.setState({ days: d }); };
  const refreshing = data.limits.some((a) => a.refreshing);

  const { byDay, byProjectRows, byProject } = useMemo(() => {
    const days = data.days.slice(-period), from = days[0].key;
    const byDay = days.map((d) => ({ key: d.key, label: d.label, claude: 0, codex: 0 }));
    const idx = Object.fromEntries(byDay.map((d, i) => [d.key, i]));
    const byProject = {};
    for (const u of data.usage) {
      if (u.day < from) continue;
      if (idx[u.day] !== undefined) byDay[idx[u.day]][u.agent] += u.tokens;
      const p = byProject[u.project] || (byProject[u.project] = { name: u.project, outside: u.outside, claude: 0, codex: 0 });
      p[u.agent] += u.tokens;
    }
    const byProjectRows = Object.values(byProject).filter((r) => r.claude + r.codex > 0).sort((a, b) => b.claude + b.codex - a.claude - a.codex);
    return { byDay, byProjectRows, byProject };
  }, [data, period]);

  return (
    <>
      <div className="aurora" aria-hidden="true"><i /><i /></div>
      <main className="page">
        <div className="head">
          <h1>Лимиты и проекты</h1>
          <div className="meta">
            <span>{data.limits.map((a) => `${a.name} ${a.observed ? "обновлён " + a.observed : "без данных"}`).join(", ")}</span>
            <button className="icon-btn" type="button" onClick={() => run("tokens.refresh")} disabled={refreshing}><RefreshIcon spinning={refreshing} />{refreshing ? "Обновляю" : "Обновить"}</button>
          </div>
        </div>

        <div className="dials">{data.limits.map((a, i) => <AgentCard key={a.agent} a={a} index={i} />)}</div>
        <p className="legend-note">Дуга — сколько лимита израсходовано, точка<i />— сколько прошло времени окна: верх круга — начало окна, полный оборот — сброс. Если дуга обогнала точку, лимит тратится быстрее времени. Наведите на кольцо, чтобы увидеть подробности.</p>

        <Chats chats={data.chats} />

        <div className="section-head">
          <h2>Расход токенов</h2>
          <Segmented id="period" value={period} onChange={choose} options={[{ value: 1, label: "Сегодня" }, { value: 7, label: "7 дней" }, { value: 30, label: "30 дней" }]} />
        </div>
        <div className="charts">
          <DaysChart rows={byDay} period={period} />
          <ProjectsChart rows={byProjectRows} period={period} />
        </div>

        <div className="section-head"><h2>Проекты</h2></div>
        <ProjectsTable projects={data.projects} outsideChats={data.outsideChats} byProject={byProject} period={period} />
      </main>
    </>
  );
}
