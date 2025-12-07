"""
Auto-discovery interface routing system.

Automatically classifies interfaces based on patterns and learns from agent outputs.
Eliminates need to manually update routing config for new interfaces.
"""

from typing import Dict, List, Set, Optional, Tuple
import re
from dataclasses import dataclass, field


@dataclass
class RoutingRule:
    """Rule for auto-classifying interfaces to agents."""
    pattern: str  # Regex pattern to match interface names
    agents: List[str]  # Target agents
    confidence: float = 1.0  # Confidence score (0-1)
    source: str = "manual"  # "manual", "pattern", "learned"
    
    def matches(self, interface_name: str) -> bool:
        """Check if interface matches this rule."""
        return bool(re.search(self.pattern, interface_name, re.IGNORECASE))


class AutoInterfaceRouter:
    """
    Self-maintaining interface router with auto-discovery.
    
    Features:
    1. Pattern-based classification (Props, State, Store suffixes)
    2. Content-based classification (analyzes interface definition)
    3. Learning from agent outputs (tracks which agents use which interfaces)
    4. Validation warnings for unmapped interfaces
    5. Confidence scoring for routing decisions
    """
    
    def __init__(self):
        # Core routing rules (pattern-based)
        self.routing_rules: List[RoutingRule] = self._initialize_patterns()
        
        # Explicit mappings (highest priority)
        self.explicit_mappings: Dict[str, List[str]] = {}
        
        # Learned mappings from usage patterns
        self.learned_mappings: Dict[str, Dict[str, int]] = {}  # {interface: {agent: usage_count}}
        
        # Shared interfaces (available to all)
        self.shared_interfaces: Set[str] = {
            'DiceType',
            'DiceMetadata',
        }
        
        # Dependency graph (which agents depend on which)
        self.dependency_graph: Dict[str, List[str]] = {
            'frontend': ['state', 'physics'],
            'physics': ['state'],
            'testing': ['frontend', 'state', 'physics'],
            'config': [],
            'state': [],
            'performance': ['frontend', 'state', 'physics'],
        }
        
        # Content-based keyword mappings
        self.content_keywords: Dict[str, List[str]] = {
            'frontend': ['component', 'jsx', 'react', 'render', 'ui', 'layout', 'panel', 'button', 'icon'],
            'physics': ['rapier', 'rigid', 'body', 'collision', 'force', 'velocity', 'impulse'],
            'state': ['zustand', 'store', 'state', 'action', 'reducer', 'selector'],
            'testing': ['test', 'mock', 'fixture', 'stub', 'spy'],
            'config': ['config', 'settings', 'options', 'params'],
            'performance': ['performance', 'optimization', 'memo', 'cache', 'fps'],
        }
    
    def _initialize_patterns(self) -> List[RoutingRule]:
        """Initialize pattern-based routing rules."""
        return [
            # Component Props → Frontend
            RoutingRule(r'Props$', ['frontend'], 1.0, 'pattern'),
            
            # Stores → State (primary) + consumers
            RoutingRule(r'Store$', ['state', 'frontend'], 0.9, 'pattern'),
            RoutingRule(r'State$', ['state'], 0.9, 'pattern'),
            
            # Physics types → Physics
            RoutingRule(r'(Collision|Force|Velocity|Impulse|RigidBody)', ['physics'], 0.95, 'pattern'),
            
            # Config types → Config
            RoutingRule(r'Config$', ['config'], 0.9, 'pattern'),
            
            # Test types → Testing
            RoutingRule(r'(Mock|Test|Fixture)', ['testing'], 0.95, 'pattern'),
            
            # Performance types → Performance
            RoutingRule(r'(Performance|Optimization|Metrics)', ['performance'], 0.9, 'pattern'),
            
            # UI components → Frontend
            RoutingRule(r'(Panel|Toolbar|Nav|Icon|Button|Modal|Dialog)', ['frontend'], 0.85, 'pattern'),
            
            # Handlers → Frontend + relevant domain
            RoutingRule(r'Handler$', ['frontend'], 0.7, 'pattern'),
            
            # Event types → Physics (if collision/contact) or Frontend
            RoutingRule(r'(Collision|Contact)Event', ['physics', 'frontend'], 0.85, 'pattern'),
            RoutingRule(r'Event$', ['frontend'], 0.6, 'pattern'),
            
            # Asset types → State + Frontend
            RoutingRule(r'Asset$', ['state', 'frontend'], 0.8, 'pattern'),
        ]
    
    def get_interfaces_for_agent(
        self,
        agent_type: str,
        all_interfaces: Dict[str, str],
        include_shared: bool = True,
        min_confidence: float = 0.5
    ) -> Dict[str, str]:
        """
        Get interfaces relevant to specific agent with auto-discovery.
        
        Args:
            agent_type: Agent type (e.g., 'frontend', 'physics')
            all_interfaces: All available interfaces {name: definition}
            include_shared: Whether to include shared interfaces
            min_confidence: Minimum confidence threshold for routing
        
        Returns:
            Filtered interfaces for this agent
        """
        relevant_interfaces = {}
        
        for interface_name, interface_def in all_interfaces.items():
            # Check if should be routed to this agent
            should_route, confidence, source = self._should_route_to_agent(
                interface_name,
                interface_def,
                agent_type
            )
            
            if should_route and confidence >= min_confidence:
                relevant_interfaces[interface_name] = interface_def
        
        # Add shared interfaces if requested
        if include_shared:
            for interface_name in self.shared_interfaces:
                if interface_name in all_interfaces:
                    relevant_interfaces[interface_name] = all_interfaces[interface_name]
        
        return relevant_interfaces
    
    def _should_route_to_agent(
        self,
        interface_name: str,
        interface_def: str,
        agent_type: str
    ) -> Tuple[bool, float, str]:
        """
        Determine if interface should route to agent.
        
        Returns:
            (should_route: bool, confidence: float, source: str)
        """
        # 1. Check explicit mappings (highest priority)
        if interface_name in self.explicit_mappings:
            if agent_type in self.explicit_mappings[interface_name]:
                return True, 1.0, 'explicit'
        
        # 2. Check learned mappings
        if interface_name in self.learned_mappings:
            if agent_type in self.learned_mappings[interface_name]:
                usage_count = self.learned_mappings[interface_name][agent_type]
                total_usage = sum(self.learned_mappings[interface_name].values())
                confidence = usage_count / total_usage if total_usage > 0 else 0
                
                if confidence > 0.3:  # At least 30% of usage
                    return True, confidence, 'learned'
        
        # 3. Check pattern-based rules
        for rule in self.routing_rules:
            if rule.matches(interface_name):
                if agent_type in rule.agents:
                    return True, rule.confidence, 'pattern'
        
        # 4. Check content-based classification
        content_confidence = self._classify_by_content(interface_def, agent_type)
        if content_confidence > 0.5:
            return True, content_confidence, 'content'
        
        # 5. Check dependency chain
        # If agent depends on another agent, inherit that agent's interfaces
        dependencies = self.dependency_graph.get(agent_type, [])
        for dep_agent in dependencies:
            dep_should_route, dep_confidence, dep_source = self._should_route_to_agent(
                interface_name,
                interface_def,
                dep_agent
            )
            if dep_should_route:
                # Inherit with reduced confidence
                return True, dep_confidence * 0.7, f'inherited_from_{dep_agent}'
        
        return False, 0.0, 'unmatched'
    
    def _classify_by_content(self, interface_def: str, agent_type: str) -> float:
        """
        Classify interface by analyzing its content.
        
        Returns:
            Confidence score (0-1)
        """
        keywords = self.content_keywords.get(agent_type, [])
        if not keywords:
            return 0.0
        
        # Count keyword matches in interface definition
        matches = 0
        for keyword in keywords:
            if re.search(rf'\b{keyword}\b', interface_def, re.IGNORECASE):
                matches += 1
        
        # Calculate confidence based on match ratio
        confidence = min(matches / 3.0, 1.0)  # Cap at 1.0, 3+ matches = high confidence
        return confidence
    
    def learn_from_usage(
        self,
        agent_type: str,
        interface_name: str,
        increment: int = 1
    ):
        """
        Learn interface routing from actual usage patterns.
        
        Args:
            agent_type: Agent that used the interface
            interface_name: Name of interface used
            increment: How many times it was used (default 1)
        """
        if interface_name not in self.learned_mappings:
            self.learned_mappings[interface_name] = {}
        
        if agent_type not in self.learned_mappings[interface_name]:
            self.learned_mappings[interface_name][agent_type] = 0
        
        self.learned_mappings[interface_name][agent_type] += increment
    
    def learn_from_agent_outputs(self, agent_outputs: Dict[str, Dict]):
        """
        Automatically learn interface routing from agent outputs.
        
        Args:
            agent_outputs: {agent_name: {interfaces: {...}}}
        """
        for agent_type, output in agent_outputs.items():
            interfaces = output.get('interfaces', {})
            
            for interface_name in interfaces.keys():
                self.learn_from_usage(agent_type, interface_name)
    
    def add_explicit_mapping(self, interface_name: str, agents: List[str]):
        """
        Add explicit interface mapping (highest priority).
        
        Args:
            interface_name: Name of interface
            agents: List of agent types that should receive it
        """
        self.explicit_mappings[interface_name] = agents
    
    def add_shared_interface(self, interface_name: str):
        """
        Mark interface as shared across all agents.
        
        Args:
            interface_name: Name of interface
        """
        self.shared_interfaces.add(interface_name)
    
    def validate_routing_completeness(
        self,
        interface_names: List[str],
        all_interfaces: Dict[str, str]
    ) -> List[Dict[str, any]]:
        """
        Check if all interfaces have routing rules.
        
        Returns:
            List of warnings for unmapped interfaces with suggestions
        """
        warnings = []
        
        for interface_name in interface_names:
            # Skip shared interfaces
            if interface_name in self.shared_interfaces:
                continue
            
            # Check if it routes to at least one agent
            interface_def = all_interfaces.get(interface_name, '')
            routed_agents = []
            
            for agent_type in ['frontend', 'physics', 'state', 'testing', 'config', 'performance']:
                should_route, confidence, source = self._should_route_to_agent(
                    interface_name,
                    interface_def,
                    agent_type
                )
                
                if should_route:
                    routed_agents.append(f"{agent_type} ({confidence:.2f} via {source})")
            
            if not routed_agents:
                # Interface has no routing rules
                suggestions = self._suggest_routing(interface_name, interface_def)
                
                warnings.append({
                    'type': 'unmapped_interface',
                    'severity': 'MEDIUM',
                    'interface': interface_name,
                    'message': f"Interface '{interface_name}' has no routing rules",
                    'suggestions': suggestions,
                    'action': f"Add explicit mapping: router.add_explicit_mapping('{interface_name}', {suggestions})"
                })
            elif max(float(agent.split('(')[1].split(' ')[0]) for agent in routed_agents) < 0.7:
                # Low confidence routing
                warnings.append({
                    'type': 'low_confidence_routing',
                    'severity': 'LOW',
                    'interface': interface_name,
                    'routed_to': routed_agents,
                    'message': f"Interface '{interface_name}' has low confidence routing",
                    'action': "Consider adding explicit mapping for clarity"
                })
        
        return warnings
    
    def _suggest_routing(self, interface_name: str, interface_def: str) -> List[str]:
        """
        Suggest which agents should receive this interface.
        
        Returns:
            List of suggested agent types
        """
        suggestions = []
        
        # Analyze name patterns
        if 'Props' in interface_name:
            suggestions.append('frontend')
        if any(x in interface_name for x in ['Store', 'State']):
            suggestions.append('state')
        if any(x in interface_name for x in ['Collision', 'Force', 'Physics', 'Rigid']):
            suggestions.append('physics')
        if 'Config' in interface_name:
            suggestions.append('config')
        if any(x in interface_name for x in ['Test', 'Mock']):
            suggestions.append('testing')
        
        # Analyze content if no name-based suggestions
        if not suggestions:
            for agent_type, keywords in self.content_keywords.items():
                for keyword in keywords:
                    if re.search(rf'\b{keyword}\b', interface_def, re.IGNORECASE):
                        if agent_type not in suggestions:
                            suggestions.append(agent_type)
                        break
        
        # Default to state if still no suggestions (data types often belong to state layer)
        if not suggestions:
            suggestions.append('state')
        
        return suggestions
    
    def get_routing_report(self, all_interfaces: Dict[str, str]) -> str:
        """
        Generate routing report showing how interfaces are classified.
        
        Args:
            all_interfaces: All available interfaces
        
        Returns:
            Formatted report string
        """
        report = "📊 Interface Routing Report\n\n"
        
        # Group interfaces by agent
        agent_interfaces: Dict[str, List[Tuple[str, float, str]]] = {
            agent: [] for agent in ['frontend', 'physics', 'state', 'testing', 'config', 'performance']
        }
        
        for interface_name, interface_def in all_interfaces.items():
            for agent_type in agent_interfaces.keys():
                should_route, confidence, source = self._should_route_to_agent(
                    interface_name,
                    interface_def,
                    agent_type
                )
                
                if should_route:
                    agent_interfaces[agent_type].append((interface_name, confidence, source))
        
        # Generate report
        for agent_type, interfaces in agent_interfaces.items():
            if interfaces:
                report += f"\n{agent_type.upper()}:\n"
                for interface_name, confidence, source in sorted(interfaces, key=lambda x: -x[1]):
                    report += f"  • {interface_name} ({confidence:.2f} via {source})\n"
        
        # Shared interfaces
        if self.shared_interfaces:
            report += f"\nSHARED (all agents):\n"
            for interface_name in sorted(self.shared_interfaces):
                if interface_name in all_interfaces:
                    report += f"  • {interface_name}\n"
        
        # Learned mappings
        if self.learned_mappings:
            report += f"\n📚 LEARNED PATTERNS:\n"
            for interface_name, usage in self.learned_mappings.items():
                total = sum(usage.values())
                usage_str = ', '.join(f"{agent}: {count}/{total}" for agent, count in sorted(usage.items(), key=lambda x: -x[1]))
                report += f"  • {interface_name}: {usage_str}\n"
        
        return report
    
    def export_learned_patterns(self) -> Dict[str, List[str]]:
        """
        Export learned patterns as explicit mappings for configuration.
        
        Returns:
            Dictionary of interface → agents mappings
        """
        exported = {}
        
        for interface_name, usage in self.learned_mappings.items():
            # Only export if we have high confidence (>50% usage by an agent)
            total_usage = sum(usage.values())
            
            agents = []
            for agent, count in usage.items():
                confidence = count / total_usage if total_usage > 0 else 0
                if confidence > 0.5:
                    agents.append(agent)
            
            if agents:
                exported[interface_name] = agents
        
        return exported
