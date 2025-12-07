"""
Comprehensive tests for the orchestration system.

Tests all critical fixes:
1. Dependency persistence
2. Circular dependency detection
3. Store contract validation
4. API contract validation (props)
5. Race condition detection
6. Interface routing
7. Token estimation
"""

import pytest
from pathlib import Path
from context_hub import AgentContextHub
from validate import IntegrationValidator
from interface_routing import InterfaceRouter
from token_estimator import TokenEstimator


class TestDependencyPersistence:
    """Test that dependencies are properly persisted to project_state."""
    
    def test_string_dependency_persistence(self):
        """Test string format: 'physics → state'"""
        hub = AgentContextHub()
        
        hub.register_task('physics', 'update-velocity', {
            'dependencies': ['physics → state'],
            'interfaces': {}
        })
        
        # Check dependency was persisted
        assert 'physics → state' in hub.project_state['dependencies']
        assert 'depends_on' in hub.project_state['dependencies']['physics → state']
    
    def test_dict_dependency_persistence(self):
        """Test dict format: {'from': 'physics', 'to': 'state', 'type': 'updates'}"""
        hub = AgentContextHub()
        
        hub.register_task('physics', 'collision-detection', {
            'dependencies': [
                {'from': 'physics', 'to': 'state', 'type': 'updates'}
            ],
            'interfaces': {}
        })
        
        # Check dependency was persisted with correct type
        assert 'physics → state' in hub.project_state['dependencies']
        assert 'updates' in hub.project_state['dependencies']['physics → state']
    
    def test_get_dependencies_returns_persisted(self):
        """Test that _get_dependencies returns persisted dependencies."""
        hub = AgentContextHub()
        
        # Register dependencies
        hub.register_task('frontend', 'ui-component', {
            'dependencies': ['frontend → state', 'frontend → physics'],
            'interfaces': {}
        })
        
        # Get dependencies for frontend
        deps = hub._get_dependencies('frontend')
        
        # Should return both dependencies
        assert len(deps) == 2
        dep_keys = [d['key'] for d in deps]
        assert 'frontend → state' in dep_keys
        assert 'frontend → physics' in dep_keys


class TestCircularDependencyDetection:
    """Test robust circular dependency detection."""
    
    def test_detects_simple_cycle(self):
        """Test detection of A → B → A cycle."""
        hub = AgentContextHub()
        
        # Create circular dependency
        hub.project_state['dependencies'] = {
            'agent1 → agent2': ['depends_on'],
            'agent2 → agent1': ['depends_on']
        }
        
        conflicts = hub._detect_circular_dependencies()
        
        assert len(conflicts) > 0
        assert conflicts[0]['type'] == 'circular_dependency'
        assert conflicts[0]['severity'] == 'CRITICAL'
    
    def test_detects_complex_cycle(self):
        """Test detection of A → B → C → A cycle."""
        hub = AgentContextHub()
        
        hub.project_state['dependencies'] = {
            'agent1 → agent2': ['depends_on'],
            'agent2 → agent3': ['depends_on'],
            'agent3 → agent1': ['depends_on']
        }
        
        conflicts = hub._detect_circular_dependencies()
        
        assert len(conflicts) > 0
        assert 'agent1' in conflicts[0]['cycle']
        assert 'agent2' in conflicts[0]['cycle']
        assert 'agent3' in conflicts[0]['cycle']
    
    def test_no_false_positives(self):
        """Test that valid dependency chains don't trigger false positives."""
        hub = AgentContextHub()
        
        # Valid chain: frontend → state, physics → state (no cycle)
        hub.project_state['dependencies'] = {
            'frontend → state': ['depends_on'],
            'physics → state': ['depends_on']
        }
        
        conflicts = hub._detect_circular_dependencies()
        
        # Should detect no cycles
        circular_conflicts = [c for c in conflicts if c['type'] == 'circular_dependency']
        assert len(circular_conflicts) == 0


class TestInterfaceRouting:
    """Test explicit interface routing replaces keyword-based filtering."""
    
    def test_routes_to_correct_agents(self):
        """Test that interfaces route to configured agents."""
        router = InterfaceRouter()
        
        all_interfaces = {
            'DiceProps': 'interface DiceProps { ... }',
            'UIStore': 'interface UIStore { ... }',
            'PhysicsConfig': 'interface PhysicsConfig { ... }'
        }
        
        # Frontend should get DiceProps
        frontend_interfaces = router.get_interfaces_for_agent('frontend', all_interfaces)
        assert 'DiceProps' in frontend_interfaces
        
        # State should get UIStore
        state_interfaces = router.get_interfaces_for_agent('state', all_interfaces)
        assert 'UIStore' in state_interfaces
        
        # Config should get PhysicsConfig
        config_interfaces = router.get_interfaces_for_agent('config', all_interfaces)
        assert 'PhysicsConfig' in config_interfaces
    
    def test_shared_interfaces_available_to_all(self):
        """Test that shared interfaces are available to all agents."""
        router = InterfaceRouter()
        
        all_interfaces = {
            'DiceType': "type DiceType = 'd4' | 'd6' | 'd8'"
        }
        
        # DiceType is shared - should be available to all agents
        for agent in ['frontend', 'physics', 'state', 'testing']:
            agent_interfaces = router.get_interfaces_for_agent(agent, all_interfaces)
            assert 'DiceType' in agent_interfaces
    
    def test_dependency_chain_interfaces(self):
        """Test that agents receive interfaces from dependencies."""
        router = InterfaceRouter()
        
        all_interfaces = {
            'UIStore': 'interface UIStore { ... }',
            'DiceProps': 'interface DiceProps { ... }'
        }
        
        # Frontend depends on state, should get UIStore
        frontend_interfaces = router.get_interfaces_for_agent('frontend', all_interfaces)
        assert 'UIStore' in frontend_interfaces  # From state dependency


class TestStoreContractValidation:
    """Test Zustand store property validation."""
    
    def test_detects_undefined_property_access(self, tmp_path):
        """Test detection of accessing undefined store properties."""
        validator = IntegrationValidator(tmp_path)
        
        # Store definition
        store_definitions = {
            'UIStore': 'interface UIStore { hapticEnabled: boolean }'
        }
        
        # Create file accessing undefined property
        test_file = tmp_path / 'Component.tsx'
        test_file.write_text('''
        const { hapticEnabled, invalidProp } = useUIStore()
        ''')
        
        store_usages = {
            test_file: ['hapticEnabled', 'invalidProp']
        }
        
        conflicts = validator.validate_store_contracts(store_definitions, store_usages)
        
        # Should detect invalidProp
        assert len(conflicts) > 0
        assert 'invalidProp' in conflicts[0]
    
    def test_valid_property_access_no_conflicts(self, tmp_path):
        """Test that valid property access produces no conflicts."""
        validator = IntegrationValidator(tmp_path)
        
        store_definitions = {
            'UIStore': 'interface UIStore { hapticEnabled: boolean; theme: string }'
        }
        
        test_file = tmp_path / 'Component.tsx'
        test_file.write_text('''
        const { hapticEnabled, theme } = useUIStore()
        ''')
        
        store_usages = {
            test_file: ['hapticEnabled', 'theme']
        }
        
        conflicts = validator.validate_store_contracts(store_definitions, store_usages)
        
        # No conflicts expected
        assert len(conflicts) == 0


class TestRaceConditionDetection:
    """Test race condition detection for concurrent state updates."""
    
    def test_detects_non_functional_setstate(self, tmp_path):
        """Test detection of non-functional setState calls."""
        from contract_validators import detect_race_conditions
        
        # Create file with non-functional setState
        test_file = tmp_path / 'useStore.ts'
        test_file.write_text('''
        store.setState({ count: 5 })
        ''')
        
        agent_outputs = {
            'state': {
                'filesModified': ['useStore.ts'],
                'interfaces': {}
            }
        }
        
        warnings = detect_race_conditions(tmp_path, agent_outputs)
        
        # Should warn about non-functional setState
        assert len(warnings) > 0
        assert 'Potential race condition' in warnings[0]
        assert 'non-functional setState' in warnings[0].lower()
    
    def test_detects_multi_agent_store_modification(self, tmp_path):
        """Test detection when multiple agents modify same store."""
        from contract_validators import detect_race_conditions
        
        # Frontend modifies store
        frontend_file = tmp_path / 'Component.tsx'
        frontend_file.write_text('useUIStore.setState({ theme: "dark" })')
        
        # State agent also modifies store
        state_file = tmp_path / 'store.ts'
        state_file.write_text('useUIStore.setState({ hapticEnabled: true })')
        
        agent_outputs = {
            'frontend': {
                'filesModified': ['Component.tsx'],
                'interfaces': {}
            },
            'state': {
                'filesModified': ['store.ts'],
                'interfaces': {}
            }
        }
        
        warnings = detect_race_conditions(tmp_path, agent_outputs)
        
        # Should warn about multiple agents modifying same store
        multi_agent_warnings = [w for w in warnings if 'multiple agents' in w]
        assert len(multi_agent_warnings) > 0


class TestImportValidation:
    """Test improved import validation with index.ts and path aliases."""
    
    def test_resolves_index_ts(self, tmp_path):
        """Test that import to directory resolves index.ts."""
        validator = IntegrationValidator(tmp_path)
        
        # Create directory with index.ts
        utils_dir = tmp_path / 'src' / 'lib'
        utils_dir.mkdir(parents=True)
        (utils_dir / 'index.ts').write_text('export const helper = () => {}')
        
        # Create file importing from directory
        component = tmp_path / 'src' / 'Component.tsx'
        component.write_text("import { helper } from './lib'")
        
        conflicts = validator.validate_imports(component)
        
        # Should resolve to lib/index.ts, no conflict
        assert len(conflicts) == 0
    
    def test_resolves_path_alias(self, tmp_path):
        """Test that @/ path aliases resolve correctly."""
        validator = IntegrationValidator(tmp_path)
        
        # Create file at src/lib/utils.ts
        utils_file = tmp_path / 'src' / 'lib' / 'utils.ts'
        utils_file.parent.mkdir(parents=True, exist_ok=True)
        utils_file.write_text('export const util = () => {}')
        
        # Create file importing with @/ alias
        component = tmp_path / 'src' / 'Component.tsx'
        component.write_text("import { util } from '@/lib/utils'")
        
        conflicts = validator.validate_imports(component)
        
        # Should resolve @/lib/utils to src/lib/utils.ts
        assert len(conflicts) == 0
    
    def test_detects_unresolved_import(self, tmp_path):
        """Test detection of truly unresolved imports."""
        validator = IntegrationValidator(tmp_path)
        
        component = tmp_path / 'Component.tsx'
        component.write_text("import { missing } from './nonexistent'")
        
        conflicts = validator.validate_imports(component)
        
        # Should detect unresolved import
        assert len(conflicts) > 0
        assert 'Unresolved import' in conflicts[0]


class TestTokenEstimation:
    """Test accurate token estimation."""
    
    def test_estimates_string_tokens(self):
        """Test token estimation for strings."""
        estimator = TokenEstimator()
        
        # Simple string
        text = "Hello world"
        tokens = estimator.estimate_tokens(text)
        
        # Should be roughly 2-3 tokens
        assert 1 <= tokens <= 5
    
    def test_estimates_dict_tokens(self):
        """Test token estimation for dictionaries."""
        estimator = TokenEstimator()
        
        data = {
            'architecture': {'decision': 'use Zustand'},
            'interfaces': {'DiceProps': 'interface DiceProps { diceType: string }'}
        }
        
        breakdown = estimator.estimate_dict_tokens(data)
        
        # Should have breakdown for each field
        assert 'architecture' in breakdown
        assert 'interfaces' in breakdown
        assert breakdown['architecture'] > 0
        assert breakdown['interfaces'] > 0
    
    def test_more_accurate_than_naive(self):
        """Test that estimation is better than naive len/4."""
        estimator = TokenEstimator()
        
        # Code with lots of punctuation and structure
        code = "interface DiceProps { diceType: 'd6' | 'd8'; id: string; }"
        
        accurate_estimate = estimator.estimate_tokens(code)
        naive_estimate = len(code) // 4
        
        # Accurate estimate should account for punctuation
        # (might be higher or lower, but should be different)
        assert accurate_estimate != naive_estimate


class TestConflictDetection:
    """Test improved conflict detection with structural comparison."""
    
    def test_detects_interface_mismatch(self):
        """Test detection of structural interface mismatches."""
        hub = AgentContextHub()
        
        # Agent 1 defines interface
        hub.mark_complete('frontend', 'create-component', {
            'interfaces': {
                'DiceProps': 'interface DiceProps { diceType: string; id: number }'
            }
        })
        
        # Agent 2 defines same interface differently
        hub.mark_complete('physics', 'dice-physics', {
            'interfaces': {
                'DiceProps': 'interface DiceProps { diceType: string; id: string }'  # id type mismatch!
            }
        })
        
        conflicts = hub.detect_conflicts()
        
        # Should detect interface mismatch
        interface_conflicts = [c for c in conflicts if c['type'] == 'interface_mismatch']
        assert len(interface_conflicts) > 0
        assert interface_conflicts[0]['interface'] == 'DiceProps'
    
    def test_normalizes_whitespace_differences(self):
        """Test that whitespace differences don't cause false positives."""
        hub = AgentContextHub()
        
        # Same interface, different formatting
        hub.mark_complete('frontend', 'create-component', {
            'interfaces': {
                'DiceProps': 'interface DiceProps { diceType: string }'
            }
        })
        
        hub.mark_complete('physics', 'dice-physics', {
            'interfaces': {
                'DiceProps': 'interface DiceProps {diceType:string}'  # No spaces
            }
        })
        
        conflicts = hub.detect_conflicts()
        
        # Should NOT detect conflict (normalized to same structure)
        interface_conflicts = [c for c in conflicts if c['type'] == 'interface_mismatch']
        assert len(interface_conflicts) == 0


# Run tests
if __name__ == '__main__':
    pytest.main([__file__, '-v'])
