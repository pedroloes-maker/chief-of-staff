import { SignIn } from "@clerk/react";
import BrandMark from "../components/ui/BrandMark";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-base px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center text-center">
          <BrandMark size="lg" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-fg">
            Chief-of-Staff
          </h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            Acesso interno do time SmartTalks
          </p>
        </div>
        <SignIn
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "rounded-card border border-black/[0.08] bg-white shadow-card",
              headerTitle: "text-fg tracking-tight",
              headerSubtitle: "text-fg-muted",
              socialButtonsBlockButton:
                "rounded-full border border-black/[0.12] transition-colors hover:bg-black/[0.03]",
              formFieldInput: "rounded-xl border-black/[0.12]",
              formButtonPrimary:
                "rounded-full bg-accent-bg text-white transition-colors hover:bg-black",
              footerActionLink: "text-fg hover:text-fg-muted",
            },
          }}
        />
      </div>
    </div>
  );
}
