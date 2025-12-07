"""
Explicit task→interface routing configuration.
Replaces keyword-based heuristics with deterministic mappings.
"""

from typing import Dict, List, Set


class InterfaceRouter:
    """
    Routes interfaces to appropriate agents based on explicit configuration.
    
    Benefits over keyword-based filtering:
    - Deterministic: Same input always produces same output
    - Complete: Can route interfaces with non-obvious names (DiceProps, CustomDiceAsset)
    - Maintainable: Clear single source of truth for routing rules
    - Extensible: Easy to add new agents or interface mappings
    """
    
    def __init__(self):
        # Explicit interface→agent mappings
        self.routing_config: Dict[str, List[str]] = {
            # Frontend Agent: UI components, panels, layouts
            'frontend': [
                'DiceProps',
                'CustomDiceProps', 
                'DiceIconProps',
                'PanelProps',
                'ToolbarProps',
                'BottomNavProps',
                'SettingsPanelProps',
                'ArtistTestingPanelProps',
                'ThemeSelectorProps',
                'SavedRollsPanelProps',
                'InventoryPanelProps',
            ],
            
            # Physics Agent: Rapier, collision, rigid bodies
            'physics': [
                'DiceInstance',
                'RigidBodyHandle',
                'ColliderType',
                'ForceConfig',
                'ImpulseVector',
                'VelocityThreshold',
                'CollisionEvent',
                'ContactForceEvent',
            ],
            
            # State Agent: Zustand stores, state management
            'state': [
                'UIStore',
                'InventoryState',
                'DiceManagerState', 
                'SavedRollsState',
                'ThemeState',
                'InventoryDie',
                'DiceInstance',
                'SavedRoll',
                'CustomDiceAsset',
            ],
            
            # Testing Agent: Test utilities, mocks
            'testing': [
                'TestSetup',
                'MockRigidBody',
                'MockHaptics',
                'TestFixture',
            ],
            
            # Config Agent: Configuration types
            'config': [
                'PhysicsConfig',
                'ThemeConfig',
                'StarterDiceConfig',
                'ValidationConfig',
            ],
            
            # Performance Agent: Optimization types
            'performance': [
                'PerformanceMetrics',
                'FPSMonitor',
                'MemoizationConfig',
            ],
        }
        
        # Shared interfaces accessible by all agents
        self.shared_interfaces: List[str] = [
            'DiceType',  # Core type used everywhere
            'DiceMetadata',  # Shared across state, frontend, physics
        ]
        
        # Dependency mappings: agent → [agents it depends on]
        self.dependency_graph: Dict[str, List[str]] = {
            'frontend': ['state', 'physics'],  # UI consumes state & physics
            'physics': ['state'],  # Physics updates state
            'testing': ['frontend', 'state', 'physics'],  # Tests all layers
            'config': [],  # No dependencies (base layer)
            'state': [],  # No dependencies (base layer)
            'performance': ['frontend', 'state', 'physics'],  # Optimizes all layers
        }
        
        # Build reverse lookup: interface → agents
        self._build_reverse_lookup()
    
    def _build_reverse_lookup(self):
        """Build interface_name → [agent_types] mapping."""
        self.interface_to_agents: Dict[str, Set[str]] = {}
        
        for agent, interfaces in self.routing_config.items():
            for interface in interfaces:
                if interface not in self.interface_to_agents:
                    self.interface_to_agents[interface] = set()
                self.interface_to_agents[interface].add(agent)
    
    def get_interfaces_for_agent(
        self, 
        agent_type: str,
        all_interfaces: Dict[str, str],
        include_shared: bool = True
    ) -> Dict[str, str]:
        """
        Get interfaces relevant to specific agent.
        
        Args:
            agent_type: Agent type (e.g., 'frontend', 'physics')
            all_interfaces: All available interfaces {name: definition}
            include_shared: Whether to include shared interfaces
        
        Returns:
            Filtered interfaces for this agent
        """
        relevant_interfaces = {}
        
        # Get explicitly routed interfaces
        routed_interface_names = self.routing_config.get(agent_type, [])
        
        for interface_name in routed_interface_names:
            if interface_name in all_interfaces:
                relevant_interfaces[interface_name] = all_interfaces[interface_name]
        
        # Add shared interfaces if requested
        if include_shared:
            for interface_name in self.shared_interfaces:
                if interface_name in all_interfaces:
                    relevant_interfaces[interface_name] = all_interfaces[interface_name]
        
        # Add interfaces from dependency chain
        # If agent depends on another agent, include that agent's interfaces
        dependencies = self.dependency_graph.get(agent_type, [])
        for dep_agent in dependencies:
            dep_interfaces = self.routing_config.get(dep_agent, [])
            for interface_name in dep_interfaces:
                if interface_name in all_interfaces:
                    relevant_interfaces[interface_name] = all_interfaces[interface_name]
        
        return relevant_interfaces
    
    def get_agents_for_interface(self, interface_name: str) -> Set[str]:
        """
        Get which agents should receive this interface.
        
        Args:
            interface_name: Name of interface
        
        Returns:
            Set of agent types that need this interface
        """
        # Check if it's a shared interface
        if interface_name in self.shared_interfaces:
            return set(self.routing_config.keys())
        
        # Return agents from reverse lookup
        return self.interface_to_agents.get(interface_name, set())
    
    def validate_routing_completeness(self, interface_names: List[str]) -> List[str]:
        """
        Check if all interfaces have routing rules.
        
        Args:
            interface_names: List of interface names to validate
        
        Returns:
            List of interfaces without routing rules
        """
        unrouted = []
        
        for interface_name in interface_names:
            if interface_name not in self.shared_interfaces:
                if interface_name not in self.interface_to_agents:
                    unrouted.append(interface_name)
        
        return unrouted
    
    def get_dependency_chain(self, agent_type: str) -> List[str]:
        """
        Get full dependency chain for an agent.
        
        Args:
            agent_type: Agent type
        
        Returns:
            Ordered list of dependencies (topologically sorted)
        """
        visited = set()
        chain = []
        
        def dfs(agent: str):
            if agent in visited:
                return
            visited.add(agent)
            
            for dep in self.dependency_graph.get(agent, []):
                dfs(dep)
            
            chain.append(agent)
        
        dfs(agent_type)
        return chain[:-1]  # Exclude self
    
    def add_interface_mapping(self, interface_name: str, agent_types: List[str]):
        """
        Dynamically add interface mapping.
        
        Args:
            interface_name: Name of interface
            agent_types: Agent types that should receive this interface
        """
        for agent_type in agent_types:
            if agent_type not in self.routing_config:
                self.routing_config[agent_type] = []
            
            if interface_name not in self.routing_config[agent_type]:
                self.routing_config[agent_type].append(interface_name)
        
        # Rebuild reverse lookup
        self._build_reverse_lookup()
    
    def add_shared_interface(self, interface_name: str):
        """
        Mark interface as shared across all agents.
        
        Args:
            interface_name: Name of interface
        """
        if interface_name not in self.shared_interfaces:
            self.shared_interfaces.append(interface_name)
