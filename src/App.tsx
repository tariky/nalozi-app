import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { WorkOrderList } from "@/components/work-orders/WorkOrderList";
import { WorkOrderForm } from "@/components/work-orders/WorkOrderForm";
import { WorkOrderDetail } from "@/components/work-orders/WorkOrderDetail";
import { CustomerList } from "@/components/customers/CustomerList";
import { CustomerDetail } from "@/components/customers/CustomerDetail";
import { MechanicList } from "@/components/mechanics/MechanicList";
import { Dashboard } from "@/components/analytics/Dashboard";
import { UserList } from "@/components/users/UserList";
import { LoginPage } from "@/components/auth/LoginPage";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { generateWorkOrderPDF } from "@/components/pdf/WorkOrderPDF";
import { workOrdersApi } from "@/lib/api";
import type { WorkOrder } from "@/types";
import "./index.css";

type Page =
  | "work-orders"
  | "work-orders-new"
  | "work-orders-edit"
  | "work-orders-detail"
  | "customers"
  | "customers-detail"
  | "mechanics"
  | "analytics"
  | "users";

function AppContent() {
  const { user, loading, isAdmin, isMechanic } = useAuth();
  const [page, setPage] = useState<Page>("work-orders");
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<number | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

  // Handle browser back/forward
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.slice(1) || "work-orders";
      const [mainPage, subPage, id] = hash.split("/");

      if (mainPage === "work-orders" && subPage === "new") {
        setPage("work-orders-new");
        setSelectedWorkOrderId(null);
        setSelectedCustomerId(null);
      } else if (mainPage === "work-orders" && subPage === "edit" && id) {
        setSelectedWorkOrderId(parseInt(id));
        setSelectedCustomerId(null);
        setPage("work-orders-edit");
      } else if (mainPage === "work-orders" && subPage === "view" && id) {
        setSelectedWorkOrderId(parseInt(id));
        setSelectedCustomerId(null);
        setPage("work-orders-detail");
      } else if (mainPage === "customers" && subPage === "view" && id) {
        setSelectedCustomerId(parseInt(id));
        setSelectedWorkOrderId(null);
        setPage("customers-detail");
      } else if (mainPage === "users") {
        setPage("users");
        setSelectedWorkOrderId(null);
        setSelectedCustomerId(null);
      } else {
        setPage(mainPage as Page);
        setSelectedWorkOrderId(null);
        setSelectedCustomerId(null);
      }
    };

    window.addEventListener("hashchange", handleHash);
    handleHash(); // Initial load

    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const navigate = (newPage: string) => {
    window.location.hash = newPage;
  };

  const handlePrintPDF = async (workOrder: WorkOrder) => {
    // If we only have partial data, fetch full work order
    if (!workOrder.items || !workOrder.customer) {
      const result = await workOrdersApi.getById(workOrder.id);
      if (result.success && result.data) {
        await generateWorkOrderPDF(result.data);
      }
    } else {
      await generateWorkOrderPDF(workOrder);
    }
  };

  const renderContent = () => {
    switch (page) {
      case "work-orders":
        return (
          <WorkOrderList
            onNew={() => navigate("work-orders/new")}
            onView={(id) => navigate(`work-orders/view/${id}`)}
            onEdit={(id) => navigate(`work-orders/edit/${id}`)}
            onPrintPDF={handlePrintPDF}
          />
        );

      case "work-orders-new":
        return (
          <WorkOrderForm
            onBack={() => navigate("work-orders")}
            onSaved={(workOrder) => navigate(`work-orders/view/${workOrder.id}`)}
          />
        );

      case "work-orders-edit":
        return (
          <WorkOrderForm
            workOrderId={selectedWorkOrderId || undefined}
            onBack={() =>
              selectedWorkOrderId
                ? navigate(`work-orders/view/${selectedWorkOrderId}`)
                : navigate("work-orders")
            }
            onSaved={(workOrder) => navigate(`work-orders/view/${workOrder.id}`)}
          />
        );

      case "work-orders-detail":
        return selectedWorkOrderId ? (
          <WorkOrderDetail
            workOrderId={selectedWorkOrderId}
            onBack={() => navigate("work-orders")}
            onEdit={() => navigate(`work-orders/edit/${selectedWorkOrderId}`)}
            onDelete={() => navigate("work-orders")}
            onPrintPDF={handlePrintPDF}
          />
        ) : null;

      case "customers":
        return (
          <CustomerList
            onView={(id) => navigate(`customers/view/${id}`)}
          />
        );

      case "customers-detail":
        return selectedCustomerId ? (
          <CustomerDetail
            customerId={selectedCustomerId}
            onBack={() => navigate("customers")}
            onEdit={() => navigate("customers")} // For now, just go back - could add edit page
            onViewWorkOrder={(id) => navigate(`work-orders/view/${id}`)}
          />
        ) : null;

      case "mechanics":
        return <MechanicList />;

      case "analytics":
        // Only admin can access analytics
        if (!isAdmin) {
          navigate("work-orders");
          return null;
        }
        return <Dashboard />;

      case "users":
        // Only admin can access users
        if (!isAdmin) {
          navigate("work-orders");
          return null;
        }
        return <UserList />;

      default:
        return null;
    }
  };

  // Show loading while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Učitavanje...</div>
      </div>
    );
  }

  // Show login if not authenticated
  if (!user) {
    return <LoginPage />;
  }

  // Get main page for navigation highlight
  const mainPage = page.startsWith("work-orders")
    ? "work-orders"
    : page.startsWith("customers")
    ? "customers"
    : page;

  return (
    <Layout currentPage={mainPage} onNavigate={navigate} userRole={user.role}>
      {renderContent()}
    </Layout>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
