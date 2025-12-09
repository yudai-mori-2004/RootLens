export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <main className="flex flex-col items-center gap-8 p-8">
        <h1 className="text-4xl font-bold">Welcome</h1>
        <p className="text-lg">
          Visit <a href="/c2pa-test" className="underline">/c2pa-test</a> to test C2PA functionality.
        </p>
      </main>
    </div>
  );
}
