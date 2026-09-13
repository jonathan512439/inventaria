import ConfirmEmail from "@/components/ConfirmEmail";

// Edge para que next-on-pages la sirva como función (evita "Unable to find lambda for route")
export const runtime = "edge";

export default function ConfirmPage() {
  return <ConfirmEmail />;
}
