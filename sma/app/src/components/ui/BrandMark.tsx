/* Marca geométrica — abertura/íris, eco do orb do app do executivo (chief/). */
export default function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 rounded-2xl" : "h-8 w-8 rounded-[10px]";
  const iris = size === "lg" ? "h-5 w-5 border-2" : "h-3 w-3 border-[1.5px]";
  return (
    <div
      className={`flex items-center justify-center bg-accent-bg shadow-card ${box}`}
    >
      <div className={`rounded-full border-white/90 ${iris}`} />
    </div>
  );
}
