export default function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card transition-shadow duration-300 ease-glide hover:shadow-float">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        {title}
      </div>
      <div className="mt-2.5 text-sm leading-relaxed text-fg">{body}</div>
    </div>
  );
}
