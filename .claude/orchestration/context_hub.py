"""
AgentContextHub: Maintains project state across distributed agents.
Never stores full implementation details—only interfaces and contracts.
"""

from typing import Dict, List, Optional, Any, Set, Tuple
from .interface_routing import InterfaceRouter
from .auto_router import AutoInterfaceRouter
from .token_estimator import estimate_dict_tokens, estimate_tokens


class AgentContextHub:
    def __init__(self):
        self.project_state = {
            'architecture': {},      # High-level decisions (e.g., "use Zustand for state")
            'dependencies': {},      # Inter-agent dependencies (e.g., "physics → state")
            'completions': {},       # Finished tasks (e.g., "useHapticFeedback implemented")
            'interfaces': {},        # Contract definitions (TypeScript interfaces)
            'conflicts': []          # Detected inconsistencies
        }
        self.agent_contexts = {}     # Per-agent context allocations
        self.token_budgets = {       # Max tokens per agent type
            'orchestrator': 1000,
            'frontend': 2000,
            'physics': 2000,
            'state': 1500,
            'testing': 1500,
            'config': 1000,
            'performance': 2000      # Performance optimization agent
        }
        
        # Initialize interface routers
        self.interface_router = InterfaceRouter()  # Legacy explicit routing
        self.auto_router = AutoInterfaceRouter()  # Auto-discovery routing (recommended)
        
        # Routing mode: 'auto' (default), 'explicit', 'hybrid'
        self.routing_mode = 'auto'

    def register_task(self, agent_type: str, task_name: str, context: dict) -> dict:
        """
        Register a new task with minimal context.
        Extract only dependencies, interfaces, and critical notes.
        """
        allocation = {
            'task_name': task_name,
            'dependencies': context.get('dependencies', []),
            'interfaces': context.get('interfaces', {}),
            'critical_notes': context.get('critical_notes', []),
            'test_requirements': context.get('test_requirements', []),
            'token_budget': self.token_budgets.get(agent_type, 1500)
        }

        if agent_type not in self.agent_contexts:
            self.agent_contexts[agent_type] = []

        self.agent_contexts[agent_type].append(allocation)
        
        # FIX: Persist dependencies to project_state (was missing!)
        # Dependencies should be stored as normalized relationships
        task_dependencies = context.get('dependencies', [])
        for dep in task_dependencies:
            # Normalize dependency format: "source_agent → target_agent"
            if isinstance(dep, dict):
                # Handle dict format: {"from": "physics", "to": "state", "type": "updates"}
                dep_key = f"{dep.get('from', agent_type)} → {dep.get('to', '')}"
                dep_value = dep.get('type', 'depends_on')
            elif isinstance(dep, str):
                # Handle string format: "physics → state"
                if '→' in dep or '->' in dep:
                    dep_key = dep.replace('->', '→')
                    dep_value = 'depends_on'
                else:
                    # Assume it's a target agent name
                    dep_key = f"{agent_type} → {dep}"
                    dep_value = 'depends_on'
            else:
                continue
            
            # Store dependency in project_state
            if dep_key not in self.project_state['dependencies']:
                self.project_state['dependencies'][dep_key] = []
            
            if dep_value not in self.project_state['dependencies'][dep_key]:
                self.project_state['dependencies'][dep_key].append(dep_value)
        
        return allocation

    def get_agent_context(self, agent_type: str) -> dict:
        """
        Return only the context allocated to this agent type.
        Excludes all other agent contexts to maintain boundaries.
        """
        return {
            'architecture': self.project_state['architecture'],
            'tasks': self.agent_contexts.get(agent_type, []),
            'interfaces': self._filter_interfaces(agent_type),
            'dependencies': self._get_dependencies(agent_type)
        }

    def _filter_interfaces(self, agent_type: str) -> dict:
        """
        Return interfaces relevant to this agent.
        
        Uses auto-discovery routing by default for zero-maintenance operation.
        Falls back to explicit routing if configured.
        """
        if self.routing_mode == 'auto':
            # Use auto-discovery router (learns from usage patterns)
            return self.auto_router.get_interfaces_for_agent(
                agent_type,
                self.project_state['interfaces'],
                include_shared=True
            )
        elif self.routing_mode == 'explicit':
            # Use explicit configuration only
            return self.interface_router.get_interfaces_for_agent(
                agent_type,
                self.project_state['interfaces'],
                include_shared=True
            )
        else:  # 'hybrid'
            # Combine both approaches (explicit takes precedence)
            auto_interfaces = self.auto_router.get_interfaces_for_agent(
                agent_type,
                self.project_state['interfaces'],
                include_shared=True
            )
            explicit_interfaces = self.interface_router.get_interfaces_for_agent(
                agent_type,
                self.project_state['interfaces'],
                include_shared=True
            )
            
            # Merge (explicit overrides auto)
            return {**auto_interfaces, **explicit_interfaces}
    
    def set_routing_mode(self, mode: str):
        """
        Set interface routing mode.
        
        Args:
            mode: 'auto', 'explicit', or 'hybrid'
                - 'auto': Pattern-based + learned routing (zero maintenance)
                - 'explicit': Manual configuration only (full control)
                - 'hybrid': Auto-discovery + manual overrides (best of both)
        """
        if mode not in ['auto', 'explicit', 'hybrid']:
            raise ValueError(f"Invalid routing mode: {mode}. Must be 'auto', 'explicit', or 'hybrid'")
        self.routing_mode = mode
    
    def get_routing_report(self) -> str:
        """
        Get detailed report of how interfaces are being routed.
        
        Useful for understanding auto-discovery decisions and
        identifying interfaces that might need explicit configuration.
        """
        return self.auto_router.get_routing_report(self.project_state['interfaces'])
    
    def validate_routing(self) -> List[Dict[str, any]]:
        """
        Validate routing completeness and return warnings for unmapped interfaces.
        
        Returns:
            List of warnings with suggestions for unmapped interfaces
        """
        interface_names = list(self.project_state['interfaces'].keys())
        return self.auto_router.validate_routing_completeness(
            interface_names,
            self.project_state['interfaces']
        )
    
    def export_learned_routing(self) -> Dict[str, List[str]]:
        """
        Export learned routing patterns as explicit configuration.
        
        Useful for freezing auto-discovered patterns into permanent config.
        """
        return self.auto_router.export_learned_patterns()

    def _get_dependencies(self, agent_type: str) -> List[Dict[str, Any]]:
        """
        Return dependencies relevant to this agent.
        
        Returns both upstream (what this agent depends on) and
        downstream (what depends on this agent) relationships.
        """
        all_deps = self.project_state['dependencies']
        
        relevant_deps = []
        for dep_key, dep_value in all_deps.items():
            # Parse dependency key format: "source → target"
            if '→' in dep_key:
                source, target = dep_key.split('→')
                source = source.strip()
                target = target.strip()
                
                # Include if this agent is source or target
                if source == agent_type or target == agent_type:
                    relevant_deps.append({
                        'key': dep_key,
                        'source': source,
                        'target': target,
                        'types': dep_value,  # List of relationship types
                        'direction': 'upstream' if target == agent_type else 'downstream'
                    })
        
        return relevant_deps

    def mark_complete(self, agent_type: str, task_name: str, outputs: dict):
        """
        Mark task complete and store only interface outputs.
        Discard implementation details to prevent context bloat.
        Also learns interface routing patterns from actual usage.
        """
        self.project_state['completions'][task_name] = {
            'agent': agent_type,
            'interfaces': outputs.get('interfaces', {}),
            'exports': outputs.get('exports', []),
            'tests': outputs.get('tests', [])
        }

        # Update global interfaces registry
        for interface_name, interface_def in outputs.get('interfaces', {}).items():
            self.project_state['interfaces'][interface_name] = interface_def
            
            # Learn from this usage (auto-router will remember this pattern)
            self.auto_router.learn_from_usage(agent_type, interface_name)

    def detect_conflicts(self) -> List[Dict[str, Any]]:
        """
        Run validation checks to detect:
        - Type mismatches between agents (structural comparison)
        - Circular dependencies (graph cycle detection)
        - Contract violations (interface consistency)
        """
        conflicts = []
        
        # 1. Check for duplicate interface definitions with structural comparison
        interface_defs = {}
        for task_name, completion in self.project_state['completions'].items():
            agent = completion['agent']
            for interface_name, interface_def in completion['interfaces'].items():
                normalized_def = self._normalize_interface(interface_def)
                
                if interface_name in interface_defs:
                    existing_def = interface_defs[interface_name]
                    existing_normalized = self._normalize_interface(existing_def['definition'])
                    
                    # Structural comparison, not string equality
                    if existing_normalized != normalized_def:
                        conflicts.append({
                            'type': 'interface_mismatch',
                            'severity': 'CRITICAL',
                            'interface': interface_name,
                            'agent1': existing_def['agent'],
                            'agent2': agent,
                            'definition1': existing_def['definition'],
                            'definition2': interface_def,
                            'message': f"Interface '{interface_name}' has conflicting definitions from {existing_def['agent']} and {agent}"
                        })
                else:
                    interface_defs[interface_name] = {
                        'agent': agent,
                        'definition': interface_def
                    }
        
        # 2. Detect circular dependencies using graph analysis
        circular_deps = self._detect_circular_dependencies()
        conflicts.extend(circular_deps)
        
        # 3. Validate dependency consistency (no missing targets)
        missing_deps = self._validate_dependency_targets()
        conflicts.extend(missing_deps)
        
        self.project_state['conflicts'] = conflicts
        return conflicts
    
    def _normalize_interface(self, definition: str) -> str:
        """
        Normalize interface definition for structural comparison.
        Removes whitespace, comments, and formatting differences.
        """
        import re
        
        # Remove single-line comments
        no_comments = re.sub(r'//.*$', '', definition, flags=re.MULTILINE)
        
        # Remove multi-line comments
        no_comments = re.sub(r'/\*.*?\*/', '', no_comments, flags=re.DOTALL)
        
        # Normalize whitespace (collapse to single spaces)
        normalized = ' '.join(no_comments.split())
        
        # Remove trailing semicolons and commas for comparison
        normalized = normalized.replace(';', '').replace(',}', '}').replace(', }', '}')
        
        return normalized.strip()
    
    def _detect_circular_dependencies(self) -> List[Dict[str, Any]]:
        """
        Detect circular dependencies using DFS cycle detection.
        Returns list of conflicts representing circular dependency chains.
        """
        conflicts = []
        
        # Build adjacency list from dependencies
        graph: Dict[str, Set[str]] = {}
        for dep_key in self.project_state['dependencies'].keys():
            if '→' in dep_key:
                source, target = dep_key.split('→')
                source = source.strip()
                target = target.strip()
                
                if source not in graph:
                    graph[source] = set()
                graph[source].add(target)
        
        # DFS to detect cycles
        visited = set()
        rec_stack = set()
        
        def dfs(node: str, path: List[str]) -> Optional[List[str]]:
            """Returns cycle if found, None otherwise."""
            visited.add(node)
            rec_stack.add(node)
            path.append(node)
            
            for neighbor in graph.get(node, []):
                if neighbor not in visited:
                    cycle = dfs(neighbor, path[:])
                    if cycle:
                        return cycle
                elif neighbor in rec_stack:
                    # Found cycle - extract it
                    cycle_start = path.index(neighbor)
                    return path[cycle_start:] + [neighbor]
            
            rec_stack.remove(node)
            return None
        
        # Check all nodes
        for node in graph.keys():
            if node not in visited:
                cycle = dfs(node, [])
                if cycle:
                    cycle_str = ' → '.join(cycle)
                    conflicts.append({
                        'type': 'circular_dependency',
                        'severity': 'CRITICAL',
                        'cycle': cycle,
                        'message': f"Circular dependency detected: {cycle_str}"
                    })
        
        return conflicts
    
    def _validate_dependency_targets(self) -> List[Dict[str, Any]]:
        """
        Validate that all dependency targets are registered agents.
        Returns list of conflicts for missing targets.
        """
        conflicts = []
        registered_agents = set(self.agent_contexts.keys())
        
        for dep_key in self.project_state['dependencies'].keys():
            if '→' in dep_key:
                source, target = dep_key.split('→')
                source = source.strip()
                target = target.strip()
                
                # Check if both source and target are registered
                if source and source not in registered_agents and source not in ['orchestrator']:
                    conflicts.append({
                        'type': 'missing_dependency_source',
                        'severity': 'HIGH',
                        'source': source,
                        'message': f"Dependency source '{source}' is not a registered agent"
                    })
                
                if target and target not in registered_agents and target not in ['orchestrator']:
                    conflicts.append({
                        'type': 'missing_dependency_target',
                        'severity': 'HIGH',
                        'target': target,
                        'message': f"Dependency target '{target}' is not a registered agent"
                    })
        
        return conflicts

    def get_token_usage(self, agent_type: str) -> dict:
        """
        Estimate token usage for an agent type using accurate token counting.
        Returns current usage, budget, and breakdown by field.
        """
        context = self.get_agent_context(agent_type)
        
        # Use improved token estimation
        token_breakdown = estimate_dict_tokens(context)
        estimated_tokens = sum(token_breakdown.values())
        
        budget = self.token_budgets.get(agent_type, 1500)
        remaining = budget - estimated_tokens
        percentage = (estimated_tokens / budget) * 100 if budget > 0 else 0
        
        return {
            'estimated_tokens': estimated_tokens,
            'budget': budget,
            'remaining': remaining,
            'percentage': percentage,
            'breakdown': token_breakdown  # Show which fields use most tokens
        }

    def clear_agent_contexts(self, agent_type: Optional[str] = None):
        """
        Clear contexts for a specific agent or all agents.
        Useful for starting fresh on new tasks.
        """
        if agent_type:
            self.agent_contexts[agent_type] = []
        else:
            self.agent_contexts = {}
