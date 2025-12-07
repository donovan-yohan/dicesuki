"""
Tests for auto-discovery interface routing system.
"""

import pytest
from auto_router import AutoInterfaceRouter, RoutingRule


class TestPatternMatching:
    """Test pattern-based interface classification."""
    
    def test_props_routes_to_frontend(self):
        """Test that *Props interfaces route to frontend."""
        router = AutoInterfaceRouter()
        
        interfaces = {
            'DiceProps': 'interface DiceProps { diceType: string }',
            'CustomDiceProps': 'interface CustomDiceProps { modelUrl: string }'
        }
        
        frontend_interfaces = router.get_interfaces_for_agent('frontend', interfaces, include_shared=False)
        
        assert 'DiceProps' in frontend_interfaces
        assert 'CustomDiceProps' in frontend_interfaces
    
    def test_store_routes_to_state(self):
        """Test that *Store interfaces route to state."""
        router = AutoInterfaceRouter()
        
        interfaces = {
            'UIStore': 'interface UIStore { hapticEnabled: boolean }',
            'DiceManagerStore': 'interface DiceManagerStore { dice: DiceInstance[] }'
        }
        
        state_interfaces = router.get_interfaces_for_agent('state', interfaces, include_shared=False)
        
        assert 'UIStore' in state_interfaces
        assert 'DiceManagerStore' in state_interfaces
    
    def test_collision_routes_to_physics(self):
        """Test that collision/force types route to physics."""
        router = AutoInterfaceRouter()
        
        interfaces = {
            'CollisionEvent': 'interface CollisionEvent { force: number }',
            'ForceConfig': 'interface ForceConfig { magnitude: number }'
        }
        
        physics_interfaces = router.get_interfaces_for_agent('physics', interfaces, include_shared=False)
        
        assert 'CollisionEvent' in physics_interfaces
        assert 'ForceConfig' in physics_interfaces
    
    def test_config_routes_to_config_agent(self):
        """Test that *Config interfaces route to config agent."""
        router = AutoInterfaceRouter()
        
        interfaces = {
            'PhysicsConfig': 'interface PhysicsConfig { gravity: number }',
            'ValidationConfig': 'interface ValidationConfig { enforceTypeMatching: boolean }'
        }
        
        config_interfaces = router.get_interfaces_for_agent('config', interfaces, include_shared=False)
        
        assert 'PhysicsConfig' in config_interfaces
        assert 'ValidationConfig' in config_interfaces


class TestContentBasedClassification:
    """Test content-based interface classification."""
    
    def test_component_keywords_route_to_frontend(self):
        """Test that interfaces with component keywords route to frontend."""
        router = AutoInterfaceRouter()
        
        interfaces = {
            'MyInterface': '''
                interface MyInterface {
                    renderComponent: () => JSX.Element;
                    buttonLabel: string;
                }
            '''
        }
        
        frontend_interfaces = router.get_interfaces_for_agent('frontend', interfaces, include_shared=False)
        
        # Should route based on 'component', 'jsx', 'button' keywords
        assert 'MyInterface' in frontend_interfaces
    
    def test_rapier_keywords_route_to_physics(self):
        """Test that interfaces with physics keywords route to physics."""
        router = AutoInterfaceRouter()
        
        interfaces = {
            'MyPhysicsType': '''
                interface MyPhysicsType {
                    rigidBody: RapierRigidBody;
                    velocity: Vector3;
                }
            '''
        }
        
        physics_interfaces = router.get_interfaces_for_agent('physics', interfaces, include_shared=False)
        
        # Should route based on 'rigidBody', 'rapier', 'velocity' keywords
        assert 'MyPhysicsType' in physics_interfaces


class TestLearningFromUsage:
    """Test learning interface routing from actual usage."""
    
    def test_learns_from_mark_complete(self):
        """Test that router learns when mark_complete is called."""
        router = AutoInterfaceRouter()
        
        # Simulate usage: frontend uses CustomDiceAsset
        router.learn_from_usage('frontend', 'CustomDiceAsset')
        router.learn_from_usage('frontend', 'CustomDiceAsset')
        router.learn_from_usage('state', 'CustomDiceAsset')
        
        # Check learned mappings
        assert 'CustomDiceAsset' in router.learned_mappings
        assert router.learned_mappings['CustomDiceAsset']['frontend'] == 2
        assert router.learned_mappings['CustomDiceAsset']['state'] == 1
    
    def test_learns_from_agent_outputs(self):
        """Test learning from complete agent output structure."""
        router = AutoInterfaceRouter()
        
        agent_outputs = {
            'frontend': {
                'interfaces': {
                    'DiceProps': 'interface DiceProps {...}',
                    'CustomAsset': 'interface CustomAsset {...}'
                }
            },
            'state': {
                'interfaces': {
                    'CustomAsset': 'interface CustomAsset {...}',
                    'InventoryState': 'interface InventoryState {...}'
                }
            }
        }
        
        router.learn_from_agent_outputs(agent_outputs)
        
        # Should learn that frontend and state both use CustomAsset
        assert 'CustomAsset' in router.learned_mappings
        assert 'frontend' in router.learned_mappings['CustomAsset']
        assert 'state' in router.learned_mappings['CustomAsset']
    
    def test_learned_patterns_influence_routing(self):
        """Test that learned patterns influence future routing decisions."""
        router = AutoInterfaceRouter()
        
        # Teach router that UnknownType goes to frontend
        for _ in range(5):
            router.learn_from_usage('frontend', 'UnknownType')
        
        interfaces = {
            'UnknownType': 'interface UnknownType { ... }'
        }
        
        # Should now route to frontend based on learned pattern
        frontend_interfaces = router.get_interfaces_for_agent('frontend', interfaces, include_shared=False)
        
        assert 'UnknownType' in frontend_interfaces


class TestExplicitMappings:
    """Test explicit mappings override auto-discovery."""
    
    def test_explicit_mapping_overrides_patterns(self):
        """Test that explicit mappings take priority over patterns."""
        router = AutoInterfaceRouter()
        
        # Add explicit mapping
        router.add_explicit_mapping('MyProps', ['state'])  # Override default frontend routing
        
        interfaces = {
            'MyProps': 'interface MyProps { ... }'
        }
        
        # Should route to state (explicit) not frontend (pattern)
        state_interfaces = router.get_interfaces_for_agent('state', interfaces, include_shared=False)
        frontend_interfaces = router.get_interfaces_for_agent('frontend', interfaces, include_shared=False)
        
        assert 'MyProps' in state_interfaces
        assert 'MyProps' not in frontend_interfaces


class TestSharedInterfaces:
    """Test shared interface functionality."""
    
    def test_shared_interfaces_available_to_all(self):
        """Test that shared interfaces are available to all agents."""
        router = AutoInterfaceRouter()
        
        # DiceType is shared by default
        interfaces = {
            'DiceType': "type DiceType = 'd4' | 'd6' | 'd8'"
        }
        
        # Should be available to all agents
        for agent in ['frontend', 'physics', 'state', 'testing', 'config']:
            agent_interfaces = router.get_interfaces_for_agent(agent, interfaces)
            assert 'DiceType' in agent_interfaces
    
    def test_can_add_shared_interfaces(self):
        """Test adding custom shared interfaces."""
        router = AutoInterfaceRouter()
        
        router.add_shared_interface('CommonType')
        
        interfaces = {
            'CommonType': 'type CommonType = string'
        }
        
        # Should be available to all agents
        for agent in ['frontend', 'physics', 'state']:
            agent_interfaces = router.get_interfaces_for_agent(agent, interfaces)
            assert 'CommonType' in agent_interfaces


class TestDependencyChainInheritance:
    """Test interface inheritance through dependency chains."""
    
    def test_frontend_inherits_state_interfaces(self):
        """Test that frontend inherits interfaces from state (its dependency)."""
        router = AutoInterfaceRouter()
        
        # Add explicit mapping to state
        router.add_explicit_mapping('StateOnlyInterface', ['state'])
        
        interfaces = {
            'StateOnlyInterface': 'interface StateOnlyInterface { ... }'
        }
        
        # Frontend depends on state, should inherit with reduced confidence
        frontend_interfaces = router.get_interfaces_for_agent('frontend', interfaces, include_shared=False)
        
        # Should be available (inherited from dependency)
        assert 'StateOnlyInterface' in frontend_interfaces


class TestRoutingValidation:
    """Test routing completeness validation."""
    
    def test_warns_about_unmapped_interfaces(self):
        """Test that validation warns about interfaces with no routing."""
        router = AutoInterfaceRouter()
        
        interfaces = {
            'TotallyUnknownInterface': 'interface TotallyUnknownInterface { x: number }'
        }
        
        warnings = router.validate_routing_completeness(
            list(interfaces.keys()),
            interfaces
        )
        
        # Should have warning about unmapped interface
        unmapped_warnings = [w for w in warnings if w['type'] == 'unmapped_interface']
        assert len(unmapped_warnings) > 0
        assert unmapped_warnings[0]['interface'] == 'TotallyUnknownInterface'
        assert 'suggestions' in unmapped_warnings[0]
    
    def test_suggests_routing_for_unmapped(self):
        """Test that validation provides routing suggestions."""
        router = AutoInterfaceRouter()
        
        interfaces = {
            'SomePropsInterface': 'interface SomePropsInterface { ... }'  # Has 'Props' pattern
        }
        
        warnings = router.validate_routing_completeness(
            list(interfaces.keys()),
            interfaces
        )
        
        # Should suggest frontend (based on Props pattern)
        # But might have low confidence, so check for suggestions
        if warnings:
            assert 'suggestions' in warnings[0]
            # Props pattern should suggest frontend
            assert 'frontend' in warnings[0]['suggestions']


class TestRoutingReport:
    """Test routing report generation."""
    
    def test_generates_routing_report(self):
        """Test that routing report shows interface classifications."""
        router = AutoInterfaceRouter()
        
        interfaces = {
            'DiceProps': 'interface DiceProps { ... }',
            'UIStore': 'interface UIStore { ... }',
            'CollisionEvent': 'interface CollisionEvent { ... }'
        }
        
        report = router.get_routing_report(interfaces)
        
        # Report should contain agent sections
        assert 'FRONTEND:' in report
        assert 'STATE:' in report
        assert 'PHYSICS:' in report
        
        # Should show specific interfaces
        assert 'DiceProps' in report
        assert 'UIStore' in report
        assert 'CollisionEvent' in report


class TestExportLearnedPatterns:
    """Test exporting learned patterns to configuration."""
    
    def test_exports_high_confidence_patterns(self):
        """Test that only high-confidence learned patterns are exported."""
        router = AutoInterfaceRouter()
        
        # Teach router strong pattern (>50% usage)
        for _ in range(10):
            router.learn_from_usage('frontend', 'MyCustomInterface')
        for _ in range(2):
            router.learn_from_usage('state', 'MyCustomInterface')
        
        exported = router.export_learned_patterns()
        
        # Should export frontend (10/12 = 83% > 50%)
        assert 'MyCustomInterface' in exported
        assert 'frontend' in exported['MyCustomInterface']
    
    def test_does_not_export_low_confidence(self):
        """Test that low-confidence patterns are not exported."""
        router = AutoInterfaceRouter()
        
        # Equal usage (50/50 split = low confidence)
        router.learn_from_usage('frontend', 'SplitInterface')
        router.learn_from_usage('state', 'SplitInterface')
        
        exported = router.export_learned_patterns()
        
        # Should not export (no agent has >50% confidence)
        assert 'SplitInterface' not in exported


class TestConfidenceScoring:
    """Test confidence scoring for routing decisions."""
    
    def test_explicit_has_highest_confidence(self):
        """Test that explicit mappings have 1.0 confidence."""
        router = AutoInterfaceRouter()
        
        router.add_explicit_mapping('ExplicitInterface', ['frontend'])
        
        interfaces = {
            'ExplicitInterface': 'interface ExplicitInterface { ... }'
        }
        
        should_route, confidence, source = router._should_route_to_agent(
            'ExplicitInterface',
            interfaces['ExplicitInterface'],
            'frontend'
        )
        
        assert should_route
        assert confidence == 1.0
        assert source == 'explicit'
    
    def test_pattern_has_high_confidence(self):
        """Test that pattern matches have appropriate confidence."""
        router = AutoInterfaceRouter()
        
        interfaces = {
            'DiceProps': 'interface DiceProps { ... }'
        }
        
        should_route, confidence, source = router._should_route_to_agent(
            'DiceProps',
            interfaces['DiceProps'],
            'frontend'
        )
        
        assert should_route
        assert confidence == 1.0  # Props pattern has 1.0 confidence
        assert source == 'pattern'
    
    def test_learned_confidence_based_on_usage(self):
        """Test that learned patterns have usage-based confidence."""
        router = AutoInterfaceRouter()
        
        # 7/10 usage by frontend = 0.7 confidence
        for _ in range(7):
            router.learn_from_usage('frontend', 'LearnedInterface')
        for _ in range(3):
            router.learn_from_usage('state', 'LearnedInterface')
        
        interfaces = {
            'LearnedInterface': 'interface LearnedInterface { ... }'
        }
        
        should_route, confidence, source = router._should_route_to_agent(
            'LearnedInterface',
            interfaces['LearnedInterface'],
            'frontend'
        )
        
        assert should_route
        assert abs(confidence - 0.7) < 0.01  # Should be ~0.7
        assert source == 'learned'


# Run tests
if __name__ == '__main__':
    pytest.main([__file__, '-v'])
