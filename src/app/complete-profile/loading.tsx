export default function Loading() {
  return (
    <section className="pt-28 pb-20 md:pt-36">
      <div className="container-msw flex justify-center">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-3">
            <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
            <div className="h-9 w-40 animate-pulse rounded bg-white/10" />
            <div className="h-4 w-56 animate-pulse rounded bg-white/5" />
          </div>
          <div className="card-dark space-y-4 p-6">
            <div className="h-12 animate-pulse rounded-xl bg-white/5" />
            <div className="h-12 animate-pulse rounded-xl bg-white/5" />
            <div className="h-12 animate-pulse rounded-xl bg-white/5" />
            <div className="h-12 animate-pulse rounded-full bg-white/10" />
          </div>
        </div>
      </div>
    </section>
  );
}
