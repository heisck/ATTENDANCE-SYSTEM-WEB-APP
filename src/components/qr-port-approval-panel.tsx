"use client";

import { useEffect, useState } from "react";
import { Share2, CheckCircle2, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface QrPortRequest {
  id: string;
  sessionId: string;
  studentId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  student: {
    id: string;
    name: string;
    email: string;
  };
}

interface QrPortApprovalPanelProps {
  sessionId: string;
  isLive?: boolean;
}

export function QrPortApprovalPanel({
  sessionId,
  isLive = true,
}: QrPortApprovalPanelProps) {
  const [requests, setRequests] = useState<QrPortRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch(
        `/api/attendance/qr-port/manage?sessionId=${encodeURIComponent(sessionId)}`
      );
      if (!res.ok) {
        throw new Error("Failed to fetch QR port requests");
      }
      const body = await res.json();
      setRequests(body.requests ?? []);
    } catch (error) {
      console.error("Failed to fetch QR port requests:", error);
      toast.error("Failed to load QR port requests");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    let interval: ReturnType<typeof setInterval> | undefined;
    if (isLive) {
      interval = setInterval(fetchData, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [sessionId, isLive]);

  const handleApprove = async (qrPortRequestId: string) => {
    setApproving(qrPortRequestId);
    try {
      const res = await fetch("/api/attendance/qr-port/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", qrPortRequestId }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Failed to approve");
      }
      toast.success("QR port approved. Student can now display the live QR.");
      await fetchData();
    } catch (error: any) {
      toast.error(error.message || "Failed to approve");
    } finally {
      setApproving(null);
    }
  };

  const handleReject = async (qrPortRequestId: string) => {
    setApproving(qrPortRequestId);
    try {
      const res = await fetch("/api/attendance/qr-port/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", qrPortRequestId }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Failed to reject");
      }
      toast.success("QR port request rejected");
      await fetchData();
    } catch (error: any) {
      toast.error(error.message || "Failed to reject");
    } finally {
      setApproving(null);
    }
  };

  const pendingRequests = requests.filter((r) => r.status === "PENDING");
  const approvedRequests = requests.filter((r) => r.status === "APPROVED");
  const rejectedRequests = requests.filter((r) => r.status === "REJECTED");

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 border-b pb-3">
        <Share2 className="h-5 w-5 text-primary" />
        <div>
          <h3 className="font-semibold">QR Port Requests</h3>
          <p className="text-sm text-muted-foreground">
            Students who want to display the live QR on their device for friends with bad cameras
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {pendingRequests.length > 0 && (
            <div className="space-y-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-700">
                <AlertCircle className="h-4 w-4" />
                Pending ({pendingRequests.length})
              </h4>
              <div className="space-y-2">
                {pendingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50/50 p-3"
                  >
                    <div>
                      <p className="font-medium text-amber-900">{req.student.name}</p>
                      <p className="text-xs text-amber-700">
                        {req.student.email} &middot; Requested{" "}
                        {new Date(req.requestedAt).toLocaleTimeString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(req.id)}
                        disabled={approving === req.id}
                        className="inline-flex items-center gap-1 rounded-md bg-green-100 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-200 disabled:opacity-50"
                      >
                        {approving === req.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        Accept
                      </button>
                      <button
                        onClick={() => handleReject(req.id)}
                        disabled={approving === req.id}
                        className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
                      >
                        {approving === req.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {approvedRequests.length > 0 && (
            <div className="space-y-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-green-700">
                <CheckCircle2 className="h-4 w-4" />
                Approved ({approvedRequests.length})
              </h4>
              <div className="space-y-2">
                {approvedRequests.map((req) => (
                  <div
                    key={req.id}
                    className="rounded-md border border-green-200 bg-green-50/50 p-3"
                  >
                    <p className="font-medium text-green-900">{req.student.name}</p>
                    <p className="text-xs text-green-700">
                      Can display live QR for friends to scan
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rejectedRequests.length > 0 && (
            <div className="space-y-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <XCircle className="h-4 w-4" />
                Declined ({rejectedRequests.length})
              </h4>
              <div className="space-y-2">
                {rejectedRequests.map((req) => (
                  <div
                    key={req.id}
                    className="rounded-md border border-border bg-muted/30 p-3"
                  >
                    <p className="text-sm font-medium">{req.student.name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {requests.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No QR port requests for this session yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}