import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Tasks } from './pages/Tasks';
import { TaskDetail } from './pages/TaskDetail';
import { Approve } from './pages/Approve';
import { Approvals } from './pages/Approvals';
import { Assign } from './pages/Assign';
import { Assignments } from './pages/Assignments';
import { Onboarding } from './pages/Onboarding';
import { Manage } from './pages/Manage';
import { BulkUpload } from './pages/BulkUpload';
import { Stores } from './pages/Stores';
import { StoreDetail } from './pages/StoreDetail';
import { Images } from './pages/Images';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Layout />}>
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/images" element={<Images />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/tasks/:id/approve" element={<Approve />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/assignments" element={<Assignments />} />
        <Route path="/tasks/:id/assign" element={<Assign />} />
        <Route path="/stores" element={<Stores />} />
        <Route path="/stores/:id" element={<StoreDetail />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/bulk" element={<BulkUpload />} />
        <Route path="/manage" element={<Manage />} />
      </Route>
      <Route path="*" element={<Navigate to="/tasks" replace />} />
    </Routes>
  );
}
