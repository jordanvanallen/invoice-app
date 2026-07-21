<script lang="ts">
  import { page } from '$app/stores';
  import { settings } from '$lib/stores/settings';
  import { lastBackupAt, backupFailed } from '$lib/stores/backup';
  let { children } = $props();
  const navGroups = [
    { id: 'invoices', label: 'Invoices', items: [
      { href: '/', label: 'New Invoice' },
      { href: '/history', label: 'History' },
    ] },
    { id: 'expenses', label: 'Expenses', items: [
      { href: '/expenses', label: 'New Expense Report' },
      { href: '/expense-history', label: 'History' },
    ] },
    { id: 'lists', label: 'Lists', items: [
      { href: '/clients', label: 'Clients' },
      { href: '/locations', label: 'Locations' },
      { href: '/approvers', label: 'Approvers' },
    ] },
    { id: 'settings', label: 'Settings', items: [
      { href: '/settings', label: 'General' },
      { href: '/backups', label: 'Backups' },
    ] },
  ];
  const isActive = (href: string, path: string) => {
    if (href === '/') return path === '/';
    if (href === '/expense-history') return path.startsWith('/expense-history') || path.startsWith('/expense/');
    return path.startsWith(href);
  };
</script>

<div class="shell">
  <nav aria-label="Primary navigation">
    <div class="nav-groups">
      {#each navGroups as group}
        <section class="nav-group">
          <h2 id={`nav-group-${group.id}`}>{group.label}</h2>
          <ul aria-labelledby={`nav-group-${group.id}`}>
            {#each group.items as item}
              <li>
                <a href={item.href} class:active={isActive(item.href, $page.url.pathname)}>{item.label}</a>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
    <div class="rail-footer">
      <div class="who">{$settings?.inspectorName || 'Set up your details →'}</div>
      <div class="bk" class:warn={$backupFailed}>
        {#if $backupFailed}⚠ Backup failed{:else if $lastBackupAt}✓ Backed up {$lastBackupAt}{:else}Backs up on save{/if}
      </div>
    </div>
  </nav>
  <main>{@render children()}</main>
</div>

<style>
  /* Pin the shell to the viewport so the sidebar stays fixed and only main scrolls.
     The rail width scales with text size so labels don't wrap at Large/Extra-large. */
  .shell { display:grid; grid-template-columns:calc(220px * var(--fs-scale)) 1fr; height:100vh; overflow:hidden; }
  nav { background:var(--bg-surface); border-right:1px solid var(--border); display:flex; flex-direction:column; min-height:0; }
  .nav-groups { flex:1; min-height:0; overflow-y:auto; padding:var(--sp-3); }
  .nav-group + .nav-group { margin-top:var(--sp-5); }
  .nav-group h2 {
    margin:0 0 var(--sp-1); padding:0 calc(var(--sp-4) + 4px); color:var(--text-muted);
    font-size:var(--fs-xs); font-weight:700; letter-spacing:.08em; text-transform:uppercase;
  }
  ul { list-style:none; margin:0; padding:0; }
  li { margin-bottom:var(--sp-1); }
  a {
    display:flex; align-items:center; min-height:calc(56px * var(--fs-scale)); padding:0 var(--sp-4);
    border-radius:var(--r-sm); color:var(--text-primary); text-decoration:none;
    font-size:var(--fs-base); border-left:4px solid transparent; white-space:nowrap;
  }
  a:hover { background:var(--bg-sunken); }
  a.active { background:var(--accent-tint); border-left-color:var(--accent); color:var(--accent-strong); font-weight:600; }
  .rail-footer { padding:var(--sp-4); border-top:1px solid var(--border); display:flex; flex-direction:column; gap:2px; }
  .rail-footer .who { color:var(--text-secondary); font-size:var(--fs-sm); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .rail-footer .bk { color:var(--text-muted); font-size:var(--fs-xs); }
  .rail-footer .bk.warn { color:var(--amber-600); }
  main { padding:var(--sp-8); overflow:auto; }
</style>
