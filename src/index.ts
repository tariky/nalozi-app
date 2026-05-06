import { serve } from "bun";
import index from "./index.html";

// Static files for PWA
const manifest = Bun.file("src/manifest.json");
const sw = Bun.file("src/sw.js");
const icon192 = Bun.file("src/icon-192.svg");
const icon512 = Bun.file("src/icon-512.svg");

// Initialize database
import { getDB } from "./db";
getDB(); // Creates tables on startup

// API handlers
import {
  getMechanics,
  getMechanicById,
  createMechanic,
  updateMechanic,
  deleteMechanic,
} from "./api/mechanics";

import {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
} from "./api/customers";

import {
  getVehiclesByCustomer,
  getVehicleById,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  checkVin,
} from "./api/vehicles";

import {
  getWorkOrders,
  getWorkOrderById,
  getWorkOrdersByCustomer,
  createWorkOrder,
  updateWorkOrder,
  deleteWorkOrder,
  searchWorkOrders,
  addWorkOrderItem,
  updateWorkOrderItem,
  deleteWorkOrderItem,
  bulkAddWorkOrderItems,
  exportWorkOrdersCSV,
  importWorkOrdersCSV,
} from "./api/work-orders";

import { scanInvoice } from "./api/invoice-scan";

import {
  getSalesAnalytics,
  getMechanicStats,
  getAnalyticsSummary,
} from "./api/analytics";

import {
  getTimeEntries,
  startTimeEntry,
  stopTimeEntry,
  deleteTimeEntry,
} from "./api/time-entries";

import {
  login,
  logout,
  me,
  getUsers,
  createUser,
  deleteUser,
  changePassword,
} from "./api/auth";

const server = serve({
  routes: {
    // Mechanics API
    "/api/mechanics": {
      GET: getMechanics,
      POST: createMechanic,
    },
    "/api/mechanics/:id": {
      GET: getMechanicById,
      PUT: updateMechanic,
      DELETE: deleteMechanic,
    },

    // Customers API
    "/api/customers": {
      GET: getCustomers,
      POST: createCustomer,
    },
    "/api/customers/:id": {
      GET: getCustomerById,
      PUT: updateCustomer,
    },

    // Vehicles API
    "/api/vehicles": {
      POST: createVehicle,
    },
    "/api/vehicles/check-vin/:vin": {
      GET: checkVin,
    },
    "/api/vehicles/by-customer/:customerId": {
      GET: getVehiclesByCustomer,
    },
    "/api/vehicles/:id": {
      GET: getVehicleById,
      PUT: updateVehicle,
      DELETE: deleteVehicle,
    },

    // Work Orders API
    "/api/work-orders": {
      GET: getWorkOrders,
      POST: createWorkOrder,
    },
    "/api/work-orders/search": {
      GET: searchWorkOrders,
    },
    "/api/work-orders/export/csv": {
      GET: exportWorkOrdersCSV,
    },
    "/api/work-orders/import/csv": {
      POST: importWorkOrdersCSV,
    },
    "/api/work-orders/scan-invoice": {
      POST: scanInvoice,
    },
    "/api/work-orders/by-customer/:customerId": {
      GET: getWorkOrdersByCustomer,
    },
    "/api/work-orders/:id": {
      GET: getWorkOrderById,
      PUT: updateWorkOrder,
      DELETE: deleteWorkOrder,
    },
    "/api/work-orders/:id/items": {
      POST: addWorkOrderItem,
    },
    "/api/work-orders/:orderId/items/:itemId": {
      PUT: updateWorkOrderItem,
      DELETE: deleteWorkOrderItem,
    },
    "/api/work-orders/:id/items/bulk": {
      POST: bulkAddWorkOrderItems,
    },

    // Time Entries API
    "/api/work-orders/:id/time-entries": {
      GET: getTimeEntries,
    },
    "/api/work-orders/:id/time-entries/start": {
      POST: startTimeEntry,
    },
    "/api/work-orders/:id/time-entries/stop": {
      POST: stopTimeEntry,
    },
    "/api/work-orders/:orderId/time-entries/:entryId": {
      DELETE: deleteTimeEntry,
    },

    // Analytics API
    "/api/analytics/sales": {
      GET: getSalesAnalytics,
    },
    "/api/analytics/mechanics": {
      GET: getMechanicStats,
    },
    "/api/analytics/summary": {
      GET: getAnalyticsSummary,
    },

    // Auth API
    "/api/auth/login": {
      POST: login,
    },
    "/api/auth/logout": {
      POST: logout,
    },
    "/api/auth/me": {
      GET: me,
    },

    // Users API
    "/api/users": {
      GET: getUsers,
      POST: createUser,
    },
    "/api/users/:id": {
      DELETE: deleteUser,
    },
    "/api/users/:id/password": {
      PUT: changePassword,
    },

    // PWA Static Files
    "/manifest.json": {
      GET: () => new Response(manifest, {
        headers: { "Content-Type": "application/manifest+json" },
      }),
    },
    "/sw.js": {
      GET: () => new Response(sw, {
        headers: { "Content-Type": "application/javascript" },
      }),
    },
    "/icon-192.svg": {
      GET: () => new Response(icon192, {
        headers: { "Content-Type": "image/svg+xml" },
      }),
    },
    "/icon-512.svg": {
      GET: () => new Response(icon512, {
        headers: { "Content-Type": "image/svg+xml" },
      }),
    },

    // Serve index.html for all unmatched routes (SPA fallback)
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,
    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
