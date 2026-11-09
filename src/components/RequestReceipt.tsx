"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  campusDateTime,
  setNavigationKey,
  type Receipt,
} from "@/lib/client/contracts";
import { SafetyGuidance } from "./SafetyGuidance";
export function RequestReceipt({ receipt }: { receipt: Receipt }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const showKeyButton = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const content = (
    <>
      <h2 id="receipt-title" className="text-2xl font-semibold">
        Your private request is sent
      </h2>
      <p className="mt-3">
        Requested time:{" "}
        <strong>{campusDateTime(receipt.requested_slot_start)}</strong>{" "}
        (Bangkok). A practitioner still needs to approve it.
      </p>
      <p className="mt-4 font-semibold">Save your Private Access Key</p>
      <p className="mt-2">
        It cannot be recovered. Without it, you cannot check or cancel your
        request. Keep it somewhere private.
      </p>
      <p className="my-5 break-all rounded-field bg-base-200 p-4 font-mono text-xl tracking-wider select-all">
        {receipt.access_key}
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(receipt.access_key);
              setCopied(true);
              setCopyError(false);
            } catch {
              setCopyError(true);
            }
          }}
        >
          {copied ? "Key copied" : "Copy access key"}
        </button>
        <Link
          href="/requests"
          className="btn"
          onClick={() => {
            setNavigationKey(receipt.access_key);
            dialog.current?.close();
          }}
        >
          Track this request
        </Link>
      </div>
      <p role="status" className="mt-3 text-sm">
        {copyError
          ? "Copy is unavailable. Select the key above and copy it manually."
          : copied
            ? "Copied. Store your key privately before leaving this page."
            : "Your key is not saved automatically on this device."}
      </p>
      <div className="mt-5">
        <SafetyGuidance result={receipt} />
      </div>
    </>
  );
  return (
    <>
      <section className="card card-border gap-4 p-6">
        <h2 className="text-xl font-semibold">Request received</h2>
        <p>
          Your key remains available here until you leave or refresh this page.
        </p>
        <button
          ref={showKeyButton}
          className="btn self-start"
          type="button"
          onClick={() => dialog.current?.showModal()}
        >
          Show access key
        </button>
        <Link
          href="/requests"
          className="link"
          onClick={() => setNavigationKey(receipt.access_key)}
        >
          Track this request
        </Link>
        {receipt.urgency_level === "URGENT" && (
          <SafetyGuidance result={receipt} />
        )}
      </section>
      <dialog ref={dialog} className="modal" aria-labelledby="receipt-title" onClose={() => showKeyButton.current?.focus()}>
        <div className="modal-box">
          {content}
          <form method="dialog" className="modal-action">
            <button className="btn">I have saved my key</button>
          </form>
        </div>
      </dialog>
    </>
  );
}
