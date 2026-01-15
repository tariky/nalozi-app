import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/PageContainer";
import { SalesReport } from "./SalesReport";
import { MechanicReport } from "./MechanicReport";

export function Dashboard() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Analitika"
        description="Pregled prodaje i učinka mehaničara"
      />

      <Tabs defaultValue="sales" className="space-y-4 sm:space-y-6">
        <TabsList className="w-full sm:w-auto grid grid-cols-2 sm:inline-flex">
          <TabsTrigger value="sales" className="text-sm">Prodaja</TabsTrigger>
          <TabsTrigger value="mechanics" className="text-sm">Mehaničari</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-0">
          <SalesReport />
        </TabsContent>

        <TabsContent value="mechanics" className="mt-0">
          <MechanicReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}
