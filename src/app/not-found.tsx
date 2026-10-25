import { Button, Eyebrow, Panel } from "@/components/ui";

export default function NotFound(): React.JSX.Element {
  return (
    <div className="px-4 py-10 sm:py-16">
      <Panel className="mx-auto max-w-2xl">
        <Eyebrow>Not found</Eyebrow>
        <p className="my-4">
          There is nothing at this address. Check the link, or start again from
          the home page.
        </p>
        <Button href="/">Go to the home page</Button>
      </Panel>
    </div>
  );
}
