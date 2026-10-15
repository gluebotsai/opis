import { RouterProvider } from "react-router";

import { AppProviders } from "@/app/providers";
import { router } from "@/routes";

export default function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
