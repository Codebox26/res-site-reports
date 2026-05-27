/**
 * api.js — all server communication in one place.
 * Falls through gracefully; callers handle errors.
 */

const API = {
  // Base fetch with JSON response handling
  async request(method, path, body, headers = {}) {
    const options = {
      method,
      headers: {
        ...headers,
      }
    };

    if (body instanceof FormData) {
      options.body = body;
    } else if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `Server error ${res.status}`);
    }

    return data;
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  async getProjects() {
    return this.request('GET', '/api/auth/projects');
  },

  async verifyPin(projectId, pin) {
    return this.request('POST', '/api/auth/verify-pin', { projectId, pin });
  },

  // ── Submit ────────────────────────────────────────────────────────────────
  async submitReport(formData, projectToken) {
    formData.append('projectToken', projectToken);
    return this.request('POST', '/api/submit', formData, {
      'x-project-token': projectToken
    });
  },

  async getTodaySubmission(projectId) {
    return this.request('GET', `/api/submit/today/${projectId}`);
  },

  async editReport(submissionId, formData, projectToken) {
    formData.append('projectToken', projectToken);
    return this.request('PUT', `/api/submit/${submissionId}`, formData, {
      'x-project-token': projectToken
    });
  },

  // ── Admin ─────────────────────────────────────────────────────────────────
  async adminLogin(adminPin) {
    return this.request('POST', '/api/admin/login', { adminPin });
  },

  async getAdminProjects(adminToken) {
    return this.request('GET', '/api/admin/projects', null, { 'x-admin-token': adminToken });
  },

  async createProject(project, adminToken) {
    return this.request('POST', '/api/admin/projects', project, { 'x-admin-token': adminToken });
  },

  async updateProject(id, updates, adminToken) {
    return this.request('PATCH', `/api/admin/projects/${id}`, updates, { 'x-admin-token': adminToken });
  },

  async deleteProject(id, adminToken) {
    return this.request('DELETE', `/api/admin/projects/${id}`, null, { 'x-admin-token': adminToken });
  },

  async getAdminSubmissions(params, adminToken) {
    const qs = new URLSearchParams(params).toString();
    return this.request('GET', `/api/admin/submissions?${qs}`, null, { 'x-admin-token': adminToken });
  },

  getQrUrl(projectId, adminToken) {
    return `/api/qr/${projectId}`;
  }
};

// Make available globally (no module bundler)
window.API = API;
