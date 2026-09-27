export default function Loading() {
  return (
    <section className="pt-28 pb-20 md:pt-36">
      <div className="container-msw flex justify-center">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-3 text-center">
            <div className="mx-auto h-4 w-28 animate-pulse rounded bg-white/10" />
            <div className="mx-auto h-9 w-48 animate-pulse rounded bg-white/10" />
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
