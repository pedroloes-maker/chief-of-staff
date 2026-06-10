import { SignIn } from "@clerk/react";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-white">
      <div className="w-full max-w-md p-8">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-semibold tracking-tight text-neutral-950">
            Chief-of-Staff
          </h1>
          <p className="text-sm text-neutral-600">
            Acesso interno do time SmartTalks
          </p>
        </div>
        <SignIn
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "border border-neutral-900 shadow-none rounded-none",
              headerTitle: "text-neutral-950",
              headerSubtitle: "text-neutral-600",
              socialButtonsBlockButton:
                "border border-neutral-900 rounded-none hover:bg-neutral-50",
              formButtonPrimary:
                "bg-neutral-950 hover:bg-neutral-800 rounded-none text-white",
              footerActionLink: "text-neutral-950 hover:text-neutral-700",
            },
          }}
        />
      </div>
    </div>
  );
}
